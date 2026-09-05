import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { app, BrowserWindow, clipboard, dialog, webContents, type WebContents } from 'electron'
import { throwErr } from './response'

/**
 * UI 操作桥 —— 让 AI 从「只能操作数据」升级为「能看见、能点着、能等着」。
 *
 * 三件套：
 * 1. 看：takeScreenshot（webContents.capturePage 存 PNG，返回路径给 AI 读图）
 *        dumpUiTree（可交互元素树 + 稳定 CSS 选择器，AI 据此决定点什么）
 * 2. 点：clickUi / typeUi / pressKeyUi —— 主进程经 sendInputEvent 发真实
 *        鼠标/键盘事件，React 合成事件、Monaco 编辑器、悬浮补全面板全覆盖。
 *        文本插入走 insertText（对 CJK 友好，无需 IME 模拟）。
 * 3. 等：waitForUi —— 轮询文本出现/消失或选择器可见，消除验收最大 flake 来源。
 *
 * 关键设计：
 * - 元素定位在渲染层执行（executeJavaScript，不受 CSP 影响），只回传坐标；
 *   真实输入事件从主进程发出，保证走 Chromium 完整输入管线。
 * - target 支持三种写法：CSS 选择器 / 'text=包含文本'（命中最深匹配）/
 *   '#N'（最近一次 GET /ui/tree 输出的元素索引，最省 token 的用法）。
 * - 所有错误为结构化错误码：E_UI_NO_TARGET / E_UI_NOT_FOUND /
 *   E_UI_NOT_INTERACTABLE / E_UI_TIMEOUT，AI 据此分支。
 */

// ---------- 目标解析 ----------

let getMainWindow: () => BrowserWindow | null = () => null

/** 由 server.ts 的 configureBridge 注入主窗口 getter（与 /state 同源） */
export function configureUiTarget(fn?: () => BrowserWindow | null): void {
  if (fn) getMainWindow = fn
}

/** 窗口选择别名：params.window / ?window= 均可传 'main' 或 'day-panel'（可写 dayPanel） */
const WINDOW_ALIASES: Record<string, string> = {
  main: '',
  daypanel: 'day-panel',
  'day-panel': 'day-panel',
}

/** 归一窗口选择：undefined/null/'main' 都归为主窗口 */
function normalizeWindowSel(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined
  const raw = String(v).trim().toLowerCase()
  if (!raw || raw === 'main') return undefined
  const mapped = WINDOW_ALIASES[raw]
  if (!mapped) throwErr('E_BAD_REQUEST', `未知窗口: ${raw}（支持 main / day-panel）`)
  return mapped
}

/** 解析要操作的页面：main=主窗口（默认），day-panel=日程面板弹窗 */
function resolveWebContents(which?: string): WebContents {
  if (which === 'day-panel') {
    const pages = webContents
      .getAllWebContents()
      .filter((wc) => !wc.isDestroyed() && wc.getURL().includes('day-panel'))
    if (!pages.length) {
      throwErr('E_UI_NO_TARGET', '日程面板窗口未打开（先在主窗口打开「日程与打卡」弹窗）')
    }
    return pages[0]
  }
  const win = getMainWindow()
  if (win && !win.isDestroyed()) return win.webContents
  const pages = webContents
    .getAllWebContents()
    .filter((wc) => !wc.isDestroyed() && !wc.getURL().startsWith('devtools://'))
  const target =
    pages.find((wc) => {
      const w = BrowserWindow.fromWebContents(wc)
      return !!w && w.isVisible()
    }) ?? pages[0]
  if (!target) throwErr('E_UI_NO_TARGET', '没有可操作的窗口（应用尚未创建任何页面）')
  return target
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** 渲染层注入用：把纯函数序列化后带参执行，避免手拼字符串转义地狱 */
async function evalInPage<A extends unknown[], R>(
  wc: WebContents,
  fn: (...args: A) => R,
  ...args: A
): Promise<R> {
  const src = `(${fn.toString()})(${args.map((a) => JSON.stringify(a)).join(',')})`
  return (await wc.executeJavaScript(src, false)) as R
}

// ---------- 元素定位（渲染层执行，纯函数） ----------

export interface UiLocatorResult {
  found: boolean
  reason?: string
  how?: string
  visible?: boolean
  x?: number
  y?: number
  tag?: string
  text?: string
  placeholder?: string
  disabled?: boolean
  editable?: boolean
  rect?: { x: number; y: number; w: number; h: number }
  viewport?: { w: number; h: number }
  url?: string
}

/** 渲染层内执行：按 target 定位元素，返回中心坐标与状态。不抛异常，用 found/reason 表达。 */
const locateInRenderer = (spec: string, withScroll: boolean): UiLocatorResult => {
  'use strict'
  const target = String(spec ?? '')
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
  const INTERACTIVE =
    'button, a[href], input, textarea, select, summary, [role="button"], [role="tab"], ' +
    '[role="menuitem"], [role="switch"], [role="checkbox"], [role="radio"], [role="option"], ' +
    '[role="combobox"], [role="textbox"], [role="slider"], [contenteditable="true"], [contenteditable=""]'
  const isVisible = (el: Element): boolean => {
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) return false
    const s = getComputedStyle(el)
    if (s.display === 'none' || s.visibility === 'hidden' || s.pointerEvents === 'none') return false
    return el.getClientRects().length > 0
  }

  let el: Element | null = null
  let how = ''
  if (target.startsWith('text=')) {
    const needle = target.slice(5).trim().toLowerCase()
    if (!needle) return { found: false, reason: "text= 后无内容" }
    let best: Element | null = null
    let bestLen = Infinity
    const pool = document.querySelectorAll(INTERACTIVE + ', li, label, span, div, p, td, th')
    for (const c of Array.from(pool)) {
      const t = (c.textContent || '').trim().toLowerCase()
      if (t && t.includes(needle) && t.length < bestLen) {
        best = c
        bestLen = t.length
      }
    }
    if (!best) return { found: false, reason: "text= 未命中: " + needle }
    el = best
    how = 'text'
  } else {
    try {
      el = document.querySelector(target)
    } catch {
      return { found: false, reason: "CSS 选择器非法: " + target }
    }
    how = 'css'
    if (!el) return { found: false, reason: "选择器未命中: " + target }
  }

  // 命中的若是容器（如 text= 命中外层 div），下钻到内部第一个可交互后代
  const matched = el as HTMLElement
  if (!matched.matches(INTERACTIVE)) {
    const inner = el.querySelector(INTERACTIVE)
    if (inner) {
      el = inner
      how += '>inner'
    }
  }
  const host = el as HTMLElement
  const visible = isVisible(host)
  if (withScroll && visible) host.scrollIntoView({ block: 'center', inline: 'center' })
  const r = host.getBoundingClientRect()
  const input = host as HTMLInputElement
  return {
    found: true,
    how,
    visible,
    x: Math.round(clamp(r.left + r.width / 2, 1, window.innerWidth - 1)),
    y: Math.round(clamp(r.top + r.height / 2, 1, window.innerHeight - 1)),
    tag: host.tagName.toLowerCase(),
    text: (input.value || host.textContent || '').trim().slice(0, 80),
    placeholder: input.placeholder || '',
    disabled: (host as HTMLButtonElement).disabled === true || host.getAttribute('aria-disabled') === 'true',
    editable: host.isContentEditable === true || host.tagName === 'TEXTAREA' || host.tagName === 'INPUT',
    rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
    viewport: { w: window.innerWidth, h: window.innerHeight },
    url: location.href,
  }
}

// ---------- #N 索引：最近一次树 dump 的选择器缓存（按窗口隔离） ----------

const treeCache = new Map<string, string[]>()

function resolveTargetSpec(rawTarget: unknown, which?: string): string {
  const raw = String(rawTarget ?? '').trim()
  if (!raw) throwErr('E_BAD_REQUEST', '缺少 target（CSS 选择器 / text=文本 / #N 树索引）')
  const m = /^#(\d+)$/.exec(raw)
  if (m) {
    const key = which ?? 'main'
    const sel = (treeCache.get(key) ?? [])[Number(m[1])]
    if (!sel) throwErr('E_UI_NOT_FOUND', `树索引 #${m[1]} 不存在（窗口: ${key}），请先 GET /ui/tree 重新 dump`)
    return sel
  }
  return raw
}

async function locate(wc: WebContents, targetSpec: string, withScroll: boolean): Promise<UiLocatorResult> {
  return evalInPage(wc, locateInRenderer, targetSpec, withScroll)
}

function requireClickable(info: UiLocatorResult, targetSpec: string): void {
  if (!info.found) throwErr('E_UI_NOT_FOUND', info.reason ?? '元素未找到', { target: targetSpec })
  if (!info.visible) {
    throwErr('E_UI_NOT_INTERACTABLE', '元素存在但不可见/不可点（width 或 height 为 0、display:none、pointer-events:none）', {
      target: targetSpec,
      detail: info,
    })
  }
  if (info.disabled) {
    throwErr('E_UI_NOT_INTERACTABLE', '元素处于 disabled / aria-disabled 状态', { target: targetSpec, detail: info })
  }
}

// ---------- 真实输入 ----------

export interface UiWindowParam {
  /** 目标窗口：main（默认）/ day-panel（可写 dayPanel） */
  window?: unknown
}

export interface UiClickParams extends UiWindowParam {
  target?: unknown
  button?: unknown
  double?: unknown
}

/** 窗口无关的点击核心：clickUi 与 typeUi（聚焦）共用 */
async function clickOn(
  wc: WebContents,
  p: { target?: unknown; button?: unknown; double?: unknown },
  which?: string
): Promise<Record<string, unknown>> {
  const targetSpec = resolveTargetSpec(p.target, which)
  const button = p.button === 'right' || p.button === 'middle' ? p.button : 'left'
  const double = p.double === true

  const info = await locate(wc, targetSpec, true)
  requireClickable(info, targetSpec)
  const x = info.x as number
  const y = info.y as number

  wc.sendInputEvent({ type: 'mouseMove', x, y })
  await sleep(20)
  wc.sendInputEvent({ type: 'mouseDown', x, y, button, clickCount: 1 })
  await sleep(40)
  wc.sendInputEvent({ type: 'mouseUp', x, y, button, clickCount: 1 })
  if (double) {
    await sleep(60)
    wc.sendInputEvent({ type: 'mouseDown', x, y, button, clickCount: 2 })
    await sleep(40)
    wc.sendInputEvent({ type: 'mouseUp', x, y, button, clickCount: 2 })
  }
  await sleep(80) // 给 React/Monaco 一点渲染时间，返回时 DOM 已是点击后状态

  return { target: targetSpec, resolvedHow: info.how, clicked: { x, y }, button, double, before: info }
}

export async function clickUi(p: UiClickParams): Promise<Record<string, unknown>> {
  const which = normalizeWindowSel(p.window)
  return clickOn(resolveWebContents(which), p, which)
}

/** 键名归一：接受 'Enter'/'enter'/'esc'/'ArrowDown'/'down' 等常见写法 */
const KEY_ALIASES: Record<string, string> = {
  enter: 'Enter',
  cr: 'Enter',
  lf: 'Enter',
  esc: 'Escape',
  escape: 'Escape',
  tab: 'Tab',
  space: 'Space',
  ' ': 'Space',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
  backspace: 'Backspace',
  del: 'Delete',
  delete: 'Delete',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  pgup: 'PageUp',
  pgdn: 'PageDown',
  ctrl: 'Control',
  control: 'Control',
  alt: 'Alt',
  shift: 'Shift',
  meta: 'Meta',
  cmd: 'Meta',
  win: 'Meta',
}

function normalizeKeyName(k: string): string {
  const raw = k.trim()
  const mapped = KEY_ALIASES[raw.toLowerCase()]
  return mapped ?? (raw.length === 1 ? raw : raw.charAt(0).toUpperCase() + raw.slice(1))
}

function normalizeModifiers(list: unknown): string[] {
  if (!Array.isArray(list)) return []
  const out: string[] = []
  for (const item of list) {
    const name = KEY_ALIASES[String(item).toLowerCase()] ?? String(item)
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(name)) out.push(name.toLowerCase())
  }
  return [...new Set(out)]
}

export interface UiKeyParams extends UiWindowParam {
  key?: unknown
  modifiers?: unknown
}

/** 窗口无关的按键核心：pressKeyUi 与 typeUi（清空）共用 */
async function keyOn(
  wc: WebContents,
  rawKey: unknown,
  rawModifiers: unknown
): Promise<Record<string, unknown>> {
  let raw = String(rawKey ?? '').trim()
  let modifiers = normalizeModifiers(rawModifiers)
  if (!raw) throwErr('E_BAD_REQUEST', '缺少 key（如 Enter / Escape / a / ctrl+a）')
  if (raw.includes('+')) {
    const parts = raw.split('+').map((s) => s.trim()).filter(Boolean)
    const last = parts.pop() as string
    if (!parts.length) throwErr('E_BAD_REQUEST', `组合键写法非法: ${raw}`)
    raw = last
    modifiers = [...new Set([...modifiers, ...normalizeModifiers(parts)])]
  }

  wc.focus()
  await sleep(30)

  const key = normalizeKeyName(raw)
  const printable =
    key.length === 1 && !modifiers.includes('control') && !modifiers.includes('meta') && !modifiers.includes('alt')
  const isSpace = key === 'Space'
  const send = (type: 'keyDown' | 'keyUp' | 'char', keyCode: string): void => {
    wc.sendInputEvent({ type, keyCode, modifiers: modifiers as never })
  }

  send('keyDown', isSpace ? 'Space' : key)
  if (printable) send('char', key)
  else if (isSpace) send('char', ' ')
  send('keyUp', isSpace ? 'Space' : key)
  await sleep(60)

  return { key, modifiers, printable }
}

/** 支持组合键写法 key: 'ctrl+a'，或分开传 key + modifiers: ['ctrl'] */
export async function pressKeyUi(p: UiKeyParams): Promise<Record<string, unknown>> {
  const wc = resolveWebContents(normalizeWindowSel(p.window))
  return keyOn(wc, p.key, p.modifiers)
}

export interface UiTypeParams extends UiWindowParam {
  target?: unknown
  text?: unknown
  clear?: unknown
}

/** 点击聚焦（可选）→ 清空（可选）→ insertText 整段插入（CJK 友好） */
export async function typeUi(p: UiTypeParams): Promise<Record<string, unknown>> {
  const which = normalizeWindowSel(p.window)
  const wc = resolveWebContents(which)
  const text = p.text === undefined || p.text === null ? '' : String(p.text)
  const clear = p.clear === true

  let focusInfo: Record<string, unknown> | null = null
  if (p.target !== undefined && p.target !== null && String(p.target).trim()) {
    focusInfo = await clickOn(wc, { target: p.target }, which)
  } else {
    wc.focus()
    await sleep(30)
  }

  let cleared = false
  if (clear) {
    await keyOn(wc, 'a', ['ctrl'])
    await sleep(40)
    await keyOn(wc, 'Delete', [])
    cleared = true
    await sleep(40)
  }

  let inserted = false
  if (text) {
    await wc.insertText(text)
    inserted = true
    await sleep(80)
  }

  return { typedLength: text.length, cleared, inserted, focus: focusInfo }
}

// ---------- 等待 ----------

export interface UiWaitParams extends UiWindowParam {
  target?: unknown
  text?: unknown
  textGone?: unknown
  timeoutMs?: unknown
  pollMs?: unknown
}

export async function waitForUi(p: UiWaitParams): Promise<Record<string, unknown>> {
  const which = normalizeWindowSel(p.window)
  const wc = resolveWebContents(which)
  const targetSpec = p.target === undefined || p.target === null ? '' : String(p.target).trim()
  const text = p.text === undefined || p.text === null ? '' : String(p.text)
  const textGone = p.textGone === undefined || p.textGone === null ? '' : String(p.textGone)
  if (!targetSpec && !text && !textGone) {
    throwErr('E_BAD_REQUEST', '至少需要一个等待条件：target / text / textGone')
  }
  const timeoutMs = Math.min(60000, Math.max(200, Number(p.timeoutMs ?? 8000)))
  const pollMs = Math.min(2000, Math.max(80, Number(p.pollMs ?? 250)))
  const start = Date.now()

  const lastFail: Record<string, unknown> = {}
  for (;;) {
    if (targetSpec) {
      const info = await locate(wc, resolveTargetSpec(targetSpec, which), false)
      if (info.found && info.visible && !info.disabled) {
        return { elapsedMs: Date.now() - start, predicate: 'target', detail: info }
      }
      lastFail.target = { found: info.found, visible: info.visible, reason: info.reason }
    }
    if (text) {
      const has = await evalInPage(
        wc,
        (needle: string) => (document.body?.innerText ?? '').includes(needle),
        text
      )
      if (has) return { elapsedMs: Date.now() - start, predicate: 'text' }
      lastFail.text = text
    }
    if (textGone) {
      const has = await evalInPage(
        wc,
        (needle: string) => (document.body?.innerText ?? '').includes(needle),
        textGone
      )
      if (!has) return { elapsedMs: Date.now() - start, predicate: 'textGone' }
      lastFail.textGone = textGone
    }
    if (Date.now() - start > timeoutMs) {
      throwErr('E_UI_TIMEOUT', `等待条件超时（${timeoutMs}ms）`, { waitedMs: Date.now() - start, last: lastFail })
    }
    await sleep(pollMs)
  }
}

// ---------- 看：截图 ----------

/** 截图输出目录：环境变量 > 工程 tmp/devbridge（AI 会话可直接 Read）> userData */
function shotDir(): string {
  const envDir = process.env.KNOWBASE_DEV_BRIDGE_SHOT_DIR
  if (envDir) return envDir
  let dir = app.getAppPath()
  for (let i = 0; i < 4; i++) {
    if (existsSync(join(dir, 'package.json'))) return join(dir, 'tmp', 'devbridge')
    const up = dirname(dir)
    if (up === dir) break
    dir = up
  }
  return join(app.getPath('userData'), 'devbridge-shots')
}

export interface ScreenshotResult {
  file: string
  width: number
  height: number
  sizeBytes: number
  restoredWindow: boolean
}

export async function takeScreenshot(which?: string): Promise<ScreenshotResult> {
  const wc = resolveWebContents(which)
  const win = BrowserWindow.fromWebContents(wc)
  let restoredWindow = false
  if (win) {
    // 最小化/隐藏窗口 capturePage 会得到空图，先以不抢焦点的方式还原
    if (win.isMinimized()) {
      win.restore()
      win.showInactive()
      restoredWindow = true
    } else if (!win.isVisible()) {
      win.showInactive()
      restoredWindow = true
    }
  }
  await sleep(150) // 等一帧完成绘制
  const img = await wc.capturePage()
  const png = img.toPNG()
  if (!png.length) {
    throwErr('E_INTERNAL', '截图为空（窗口可能被完全遮挡或尚未绘制）')
  }
  const dir = shotDir()
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `shot-${Date.now()}.png`)
  writeFileSync(file, png)
  const size = img.getSize()
  return { file, width: size.width, height: size.height, sizeBytes: png.length, restoredWindow }
}

// ---------- 看：可交互元素树 ----------

export interface UiTreeItem {
  i: number
  sel: string
  tag: string
  role?: string
  text: string
  placeholder?: string
  value?: string
  disabled?: boolean
  rect: { x: number; y: number; w: number; h: number }
}

export interface UiTreeResult {
  count: number
  truncated: boolean
  url: string
  viewport: { w: number; h: number }
  items: UiTreeItem[]
}

const MAX_TREE_ITEMS = 300

/** 渲染层内执行：收集全部可见可交互元素并生成稳定 CSS 选择器 */
const collectTreeInRenderer = (maxItems: number): { items: UiTreeItem[]; truncated: boolean; url: string; viewport: { w: number; h: number } } => {
  'use strict'
  const INTERACTIVE =
    'button, a[href], input, textarea, select, summary, [role="button"], [role="tab"], ' +
    '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="switch"], ' +
    '[role="checkbox"], [role="radio"], [role="option"], [role="combobox"], [role="textbox"], ' +
    '[role="slider"], [contenteditable="true"], [contenteditable=""]'
  const isVisible = (el: Element): boolean => {
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) return false
    const s = getComputedStyle(el)
    if (s.display === 'none' || s.visibility === 'hidden') return false
    return el.getClientRects().length > 0
  }
  const cssPath = (el: HTMLElement): string => {
    const byId = el.id ? '#' + CSS.escape(el.id) : ''
    if (byId) {
      try {
        if (document.querySelectorAll(byId).length === 1) return byId
      } catch { /* id 含非法字符时回退路径法 */ }
    }
    const parts: string[] = []
    let cur: HTMLElement | null = el
    while (cur && cur !== document.body && parts.length < 8) {
      let part = cur.tagName.toLowerCase()
      if (typeof cur.className === 'string' && cur.className.trim()) {
        const cls = cur.className
          .trim()
          .split(/\s+/)
          .filter((c) => c && !/[:[\]()@]/.test(c) && c.length < 40)
          .slice(0, 2)
        for (const c of cls) part += '.' + CSS.escape(c)
      }
      const parent = cur.parentElement
      if (parent) {
        const same = Array.from(parent.children).filter((ch) => ch.tagName === cur!.tagName)
        if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(cur) + 1) + ')'
      }
      parts.unshift(part)
      cur = cur.parentElement
    }
    return parts.length ? parts.join(' > ') : el.tagName.toLowerCase()
  }
  const implicitRole = (el: HTMLElement): string | undefined => {
    const explicit = el.getAttribute('role')
    if (explicit) return explicit
    const tag = el.tagName.toLowerCase()
    if (tag === 'button') return 'button'
    if (tag === 'a' && el.hasAttribute('href')) return 'link'
    if (tag === 'input') {
      const t = (el as HTMLInputElement).type
      if (t === 'checkbox') return 'checkbox'
      if (t === 'radio') return 'radio'
      return 'textbox'
    }
    if (tag === 'textarea') return 'textbox'
    if (tag === 'select') return 'combobox'
    return undefined
  }

  const nodes = Array.from(document.querySelectorAll(INTERACTIVE)) as HTMLElement[]
  const items: UiTreeItem[] = []
  for (const el of nodes) {
    if (items.length >= maxItems) break
    if (!isVisible(el)) continue
    const input = el as HTMLInputElement
    const text = (input.value || el.textContent || '').trim().slice(0, 60)
    const item: UiTreeItem = {
      i: items.length,
      sel: cssPath(el),
      tag: el.tagName.toLowerCase(),
      text,
      rect: (() => {
        const r = el.getBoundingClientRect()
        return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }
      })(),
    }
    const role = implicitRole(el)
    if (role) item.role = role
    if (input.placeholder) item.placeholder = input.placeholder.slice(0, 60)
    if (el.isContentEditable) item.value = 'contenteditable'
    if ((input as HTMLButtonElement).disabled === true) item.disabled = true
    items.push(item)
  }
  return {
    items,
    truncated: nodes.length > maxItems,
    url: location.href,
    viewport: { w: window.innerWidth, h: window.innerHeight },
  }
}

export async function dumpUiTree(which?: string): Promise<UiTreeResult> {
  const wc = resolveWebContents(which)
  const result = await evalInPage(wc, collectTreeInRenderer, MAX_TREE_ITEMS)
  treeCache.set(which ?? 'main', result.items.map((it) => it.sel))
  return { count: result.items.length, truncated: result.truncated, url: result.url, viewport: result.viewport, items: result.items }
}

// ---------- P1：滚轮（列表滚动验收） ----------

export interface UiScrollParams extends UiWindowParam {
  target?: unknown
  x?: unknown
  y?: unknown
  deltaX?: unknown
  deltaY?: unknown
}

/** 真实滚轮事件；有 target 先把光标移到元素中心再滚（悬停加载/懒滚列表才生效） */
export async function scrollUi(p: UiScrollParams): Promise<Record<string, unknown>> {
  const which = normalizeWindowSel(p.window)
  const wc = resolveWebContents(which)
  const deltaX = Number(p.deltaX ?? 0)
  const deltaY = Number(p.deltaY ?? 0)
  if (!deltaX && !deltaY) {
    throwErr('E_BAD_REQUEST', '需要 deltaX / deltaY（正值向下/向右，负值向上/向左，一格约 ±120）')
  }

  let x: number
  let y: number
  if (p.target !== undefined && p.target !== null && String(p.target).trim()) {
    const spec = resolveTargetSpec(p.target, which)
    const info = await locate(wc, spec, true)
    if (!info.found) throwErr('E_UI_NOT_FOUND', info.reason ?? '元素未找到', { target: spec })
    if (!info.visible) throwErr('E_UI_NOT_INTERACTABLE', '滚动目标不可见', { target: spec, detail: info })
    x = info.x as number
    y = info.y as number
  } else {
    const vp = await evalInPage(wc, () => ({ w: window.innerWidth, h: window.innerHeight }))
    x = Math.round(vp.w / 2)
    y = Math.round(vp.h / 2)
  }

  wc.sendInputEvent({ type: 'mouseWheel', x, y, deltaX, deltaY })
  await sleep(120)
  return { at: { x, y }, deltaX, deltaY }
}

// ---------- P1：文件拖放（ImportZone / FileTree 等拖放入口） ----------

export interface UiDropFileParams extends UiWindowParam {
  target?: unknown
  x?: unknown
  y?: unknown
  files?: unknown
}

/**
 * 模拟从 OS 拖文件进应用：经内嵌 CDP debugger 走 Input.dispatchDragEvent，
 * files 传真实路径（Chromium 在页面侧构造真 File 对象），无文件大小限制。
 * dragEnter → dragOver → drop 三段派发，与真实拖放事件序一致。
 */
export async function dropFileUi(p: UiDropFileParams): Promise<Record<string, unknown>> {
  const which = normalizeWindowSel(p.window)
  const wc = resolveWebContents(which)
  const rawFiles = Array.isArray(p.files) ? p.files : []
  if (!rawFiles.length) throwErr('E_BAD_REQUEST', '缺少 files（绝对路径数组）')
  const files = rawFiles.map((f) => resolve(String(f)))
  const missing = files.filter((f) => !existsSync(f))
  if (missing.length) {
    throwErr('E_BAD_REQUEST', '以下文件不存在', { missing })
  }

  let x: number
  let y: number
  if (p.target !== undefined && p.target !== null && String(p.target).trim()) {
    const spec = resolveTargetSpec(p.target, which)
    const info = await locate(wc, spec, true)
    if (!info.found) throwErr('E_UI_NOT_FOUND', info.reason ?? '元素未找到', { target: spec })
    if (!info.visible) throwErr('E_UI_NOT_INTERACTABLE', '拖放目标不可见', { target: spec, detail: info })
    x = info.x as number
    y = info.y as number
  } else if (p.x !== undefined && p.y !== undefined) {
    x = Number(p.x)
    y = Number(p.y)
  } else {
    throwErr('E_BAD_REQUEST', '需要 target 或 x/y（拖放落点）')
  }

  const dbg = wc.debugger
  const wasAttached = dbg.isAttached()
  if (!wasAttached) {
    // attach 是同步发起；失败（如已附带 devtools）会直接抛错
    dbg.attach('1.3')
  }
  try {
    const data = { files, items: [], dragOperationsMask: 1 }
    for (const type of ['dragEnter', 'dragOver', 'drop'] as const) {
      await dbg.sendCommand('Input.dispatchDragEvent', { type, x, y, data })
      await sleep(type === 'drop' ? 150 : 60)
    }
  } finally {
    if (!wasAttached) {
      try {
        dbg.detach()
      } catch {
        /* 已自行 detach */
      }
    }
  }
  return { dropped: files.length, files, at: { x, y } }
}

// ---------- P1：原生对话框打桩（导入/备份/导出等十余处入口） ----------

interface DialogMocks {
  open?: { filePaths: string[] }
  save?: { filePath: string }
  message?: { response: number }
}

interface DialogInterception {
  api: string
  args: string
  at: string
}

let dialogPatched = false
const origDialogs: {
  open?: (...args: unknown[]) => unknown
  save?: (...args: unknown[]) => unknown
  message?: (...args: unknown[]) => unknown
} = {}
let dialogMocks: DialogMocks = {}
let dialogIntercepted: DialogInterception[] = []

/** 把 electron 的 dialog 三个函数换成打桩版；原函数只保存一次 */
function installDialogPatch(): void {
  if (dialogPatched) return
  dialogPatched = true
  const d = dialog as unknown as Record<string, (...args: unknown[]) => unknown>
  origDialogs.open = d.showOpenDialog.bind(dialog)
  origDialogs.save = d.showSaveDialog.bind(dialog)
  origDialogs.message = d.showMessageBox.bind(dialog)

  const record = (api: string, args: unknown[]): void => {
    dialogIntercepted.push({
      api,
      args: JSON.stringify(args).slice(0, 200),
      at: new Date().toISOString(),
    })
    if (dialogIntercepted.length > 100) dialogIntercepted.shift()
  }

  d.showOpenDialog = (...args: unknown[]) => {
    if (dialogMocks.open) {
      record('showOpenDialog', args)
      return Promise.resolve({ canceled: false, filePaths: [...dialogMocks.open.filePaths] })
    }
    return origDialogs.open?.(...args)
  }
  d.showSaveDialog = (...args: unknown[]) => {
    if (dialogMocks.save) {
      record('showSaveDialog', args)
      return Promise.resolve({ canceled: false, filePath: dialogMocks.save.filePath })
    }
    return origDialogs.save?.(...args)
  }
  d.showMessageBox = (...args: unknown[]) => {
    if (dialogMocks.message) {
      record('showMessageBox', args)
      return Promise.resolve({ response: dialogMocks.message.response, checkboxChecked: false })
    }
    return origDialogs.message?.(...args)
  }
}

export interface UiDialogMockParams {
  open?: unknown
  save?: unknown
  message?: unknown
}

/**
 * 设置对话框桩：open → { canceled:false, filePaths }；save → { canceled:false, filePath }；
 * message → { response }。未设置的 API 保持真身。设置后必须 ui.dialog.restore。
 */
export async function mockDialogUi(p: UiDialogMockParams): Promise<Record<string, unknown>> {
  installDialogPatch()
  const mocked: string[] = []

  if (p.open !== undefined && p.open !== null) {
    const open = p.open as { filePaths?: unknown }
    const filePaths = Array.isArray(open.filePaths) ? open.filePaths.map(String) : []
    if (!filePaths.length) throwErr('E_BAD_REQUEST', 'open.filePaths 需为非空字符串数组')
    dialogMocks.open = { filePaths }
    mocked.push('showOpenDialog')
  }
  if (p.save !== undefined && p.save !== null) {
    const save = p.save as { filePath?: unknown }
    const filePath = String(save.filePath ?? '')
    if (!filePath) throwErr('E_BAD_REQUEST', 'save.filePath 需为非空字符串')
    dialogMocks.save = { filePath }
    mocked.push('showSaveDialog')
  }
  if (p.message !== undefined && p.message !== null) {
    const message = p.message as { response?: unknown }
    dialogMocks.message = { response: Number(message.response ?? 0) }
    mocked.push('showMessageBox')
  }
  if (!mocked.length) {
    throwErr('E_BAD_REQUEST', '至少设置一个桩：open / save / message')
  }
  return {
    mocked,
    warning: '对话框已打桩（不会再弹真窗），验收结束必须调用 ui.dialog.restore 还原',
  }
}

export function restoreDialogUi(): Record<string, unknown> {
  if (!dialogPatched) return { patched: false }
  const d = dialog as unknown as Record<string, (...args: unknown[]) => unknown>
  if (origDialogs.open) d.showOpenDialog = origDialogs.open
  if (origDialogs.save) d.showSaveDialog = origDialogs.save
  if (origDialogs.message) d.showMessageBox = origDialogs.message
  const intercepted = dialogIntercepted.length
  dialogPatched = false
  dialogMocks = {}
  dialogIntercepted = []
  return { patched: true, restored: true, intercepted }
}

export function dialogStateUi(): Record<string, unknown> {
  return {
    patched: dialogPatched,
    mocked: Object.keys(dialogMocks),
    intercepted: dialogIntercepted.slice(-20),
  }
}

// ---------- P2：窗口控制（响应式布局验收） ----------

export interface UiWindowActionParams extends UiWindowParam {
  action?: unknown
  width?: unknown
  height?: unknown
}

/** resize / maximize / unmaximize / minimize / restore / info（默认，仅查看状态） */
export async function windowUi(p: UiWindowActionParams): Promise<Record<string, unknown>> {
  const wc = resolveWebContents(normalizeWindowSel(p.window))
  const win = BrowserWindow.fromWebContents(wc)
  if (!win) throwErr('E_UI_NO_TARGET', '该页面不属于任何 BrowserWindow')

  const action = String(p.action ?? 'info').trim().toLowerCase()
  if (action === 'resize') {
    const width = Number(p.width ?? 0)
    const height = Number(p.height ?? 0)
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 400 || height < 300 || width > 7680 || height > 4320) {
      throwErr('E_BAD_REQUEST', 'resize 需要 400≤width≤7680、300≤height≤4320', { width, height })
    }
    if (win.isMaximized() || win.isFullScreen()) win.unmaximize()
    win.setSize(Math.round(width), Math.round(height))
    await sleep(250) // 等布局/媒体查询稳定
  } else if (action === 'maximize') {
    win.maximize()
    await sleep(150)
  } else if (action === 'unmaximize') {
    win.unmaximize()
    await sleep(150)
  } else if (action === 'minimize') {
    win.minimize()
    await sleep(150)
  } else if (action === 'restore') {
    win.restore()
    await sleep(150)
  } else if (action !== 'info') {
    throwErr('E_BAD_REQUEST', 'action 需为 info / resize / maximize / unmaximize / minimize / restore')
  }

  return {
    action,
    bounds: win.getBounds(),
    maximized: win.isMaximized(),
    minimized: win.isMinimized(),
  }
}

// ---------- P2：剪贴板（粘贴链路验收：seed → ui.key ctrl+v → 断言） ----------

export interface UiClipboardParams {
  action?: unknown
  text?: unknown
}

export async function clipboardUi(p: UiClipboardParams): Promise<Record<string, unknown>> {
  const action = String(p.action ?? '').trim().toLowerCase()
  if (action === 'set') {
    const text = String(p.text ?? '')
    clipboard.writeText(text)
    return { set: text.length }
  }
  if (action === 'get') {
    return { text: clipboard.readText() }
  }
  if (action === 'clear') {
    clipboard.clear()
    return { cleared: true }
  }
  throwErr('E_BAD_REQUEST', 'action 需为 set / get / clear')
}
