import { existsSync, copyFileSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'fs'
import { join, basename, isAbsolute } from 'path'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import { getCurrentVault } from './kbStore/vaultContext'
import { ensureSessionFolder, rootDirName, sanitizeTitle, sessionFolder } from './aiTeachingFolders'
import { uniqueFileName } from './workspaceManager'
import { extractPdfRange, extractPptxPages } from './docsReader'
import { visionChat } from './llmService'

/**
 * AI教学模块 · 素材库（总纲 docs/ai-teaching-module-rework.md §3.13 结构 v3，P6）
 *
 * 权威结构（第四轮拍板，取代 §3.11/3.12）：
 * - 每个会话文件夹的**父目录**（工作区层；未归一=产物根层）下有 `SOURCES/` 大文件夹；
 * - 每对话一个**与会话文件夹同名**的子文件夹：`SOURCES/{对话夹名}/SOURCE.md`（登记文档）
 *   + 素材原件（3-22「已入库」拷贝）+ 同级区间提取稿 `{素材名}-p{起}-{终}.md`（3-30 命名拍板）；
 * - SOURCE.md = YAML frontmatter + 条目小节（3-28 拍板）：`### N. 名称` + 固定字段行
 *   （类型/路径/页码区间/存放方式/已提取/备注），程序按小节解析——三种录入方式（3-19 表单/对话 AI 登记/
 *   直接编辑文件）都收敛到同一份文件的解析与重写；
 * - 「已提取」程序维护（3-26），✓ 防重复提取；对话改名/删除联动在 aiTeachingFolders（3-31 跟随同设置）；
 * - 提取稿是 .md 且在仓库内 → AI 用现有 vault 读工具即可读（3-20 区间指定经目录注入达成，无新读取通道）。
 */

const SOURCE_FILE = 'SOURCE.md'
const SOURCES_DIR = 'SOURCES'
const TYPE_ENUM = ['url', 'pptx', 'pdf', 'image', 'md', 'other'] as const
export type SourceType = (typeof TYPE_ENUM)[number]

export interface SourceEntry {
  no: number
  name: string
  type: SourceType | string
  /** 素材地址：./文件名（已入库）/ 仓库内相对路径 / 绝对路径 / URL */
  path: string
  /** 页码区间原样字符串（'12-34' / '12' / '-'） */
  range: string
  /** 已入库 | 仅引用 */
  storage: string
  /** '-' 或 '✓ → 文件名' */
  extracted: string
  note: string
}

export interface SourcesResult {
  ok: boolean
  relPath?: string | null
  entries?: SourceEntry[]
  error?: string
}

interface SourcesLayout {
  rootPath: string
  rootId: string
  /** 素材文件夹仓库相对路径与绝对路径 */
  dirRel: string
  dirAbs: string
  /** SOURCE.md 相对路径 */
  fileRel: string
  /** 会话夹名（=素材子夹名）与工作区段名（未归一为空串） */
  convName: string
  wsName: string
}

function broadcastTreeRefresh(dirRel: string): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('aiTeach:tree-refresh', { dirRel })
  }
}

function today(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** 由会话 id 解析素材文件夹布局：create=true 懒建会话文件夹；false 只探测（读注入/删除用，不side-effect建夹） */
function layout(sessionId: string, getSetting: (key: string) => unknown, create: boolean): SourcesLayout | { error: string } {
  const vault = getCurrentVault()
  if (!vault) return { error: '尚未打开仓库' }
  const probe = create ? ensureSessionFolder(sessionId, getSetting) : sessionFolder(sessionId, getSetting)
  const rel = probe.relPath
  if (!rel) return { error: probe.ok ? '会话文件夹不存在' : (probe.error ?? '会话文件夹不可用') }
  const lastSlash = rel.lastIndexOf('/')
  const rootDir = rootDirName(getSetting)
  const parentRel = lastSlash > 0 ? rel.slice(0, lastSlash) : rootDir
  const convName = lastSlash > 0 ? rel.slice(lastSlash + 1) : rel
  const wsName = parentRel !== rootDir && parentRel.startsWith(`${rootDir}/`) ? parentRel.slice(rootDir.length + 1) : ''
  const dirRel = `${parentRel}/${SOURCES_DIR}/${convName}`
  return { rootPath: vault.rootPath, rootId: vault.rootId, dirRel, dirAbs: join(vault.rootPath, dirRel), fileRel: `${dirRel}/${SOURCE_FILE}`, convName, wsName }
}

function emptyTemplate(l: SourcesLayout): string {
  return [
    '---',
    `workspace: ${l.wsName || '（未归一层）'}`,
    `conversation: ${l.convName}`,
    `updated: ${today()}`,
    '---',
    '',
    '# 素材来源登记',
    '',
    '每个素材一个小节（`### 编号. 名称` + 固定字段行）。可在右栏「素材库 → ＋ 添加素材」登记，',
    '直接编辑本文件，或在对话里让 AI 按此格式登记。字段：类型(url/pptx/pdf/image/md/other)、路径、',
    '页码区间(如 12-34，无则 -)、存放方式(已入库/仅引用)、已提取(程序维护)、备注。',
    '',
  ].join('\n')
}

/** 解析 SOURCE.md → 条目数组（宽容：缺字段回退默认，编号重复保留先到者） */
export function parseSourceMd(text: string): SourceEntry[] {
  const out: SourceEntry[] = []
  const seen = new Set<number>()
  let cur: SourceEntry | null = null
  const flush = () => { if (cur && !seen.has(cur.no)) { seen.add(cur.no); out.push(cur) } cur = null }
  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    const head = /^###\s*(\d+)\s*[.、]\s*(.+?)\s*$/.exec(raw)
    if (head) {
      flush()
      cur = { no: parseInt(head[1], 10), name: head[2], type: 'other', path: '', range: '-', storage: '仅引用', extracted: '-', note: '' }
      continue
    }
    if (/^#{1,6}\s/.test(raw)) { flush(); continue } // 其他标题结束当前小节
    if (!cur) continue
    const m = /^-\s*(类型|路径|页码区间|存放方式|已提取|备注)\s*[：:]\s*(.*)$/.exec(raw.trim())
    if (!m) continue
    const val = m[2].trim()
    if (m[1] === '类型') cur.type = val.toLowerCase() || 'other'
    else if (m[1] === '路径') cur.path = val
    else if (m[1] === '页码区间') cur.range = val || '-'
    else if (m[1] === '存放方式') cur.storage = val
    else if (m[1] === '已提取') cur.extracted = val
    else if (m[1] === '备注') cur.note = val
  }
  flush()
  return out.sort((a, b) => a.no - b.no)
}

function entryToBlock(e: SourceEntry): string {
  return [
    `### ${e.no}. ${e.name}`,
    `- 类型: ${e.type}`,
    `- 路径: ${e.path || '-'}`,
    `- 页码区间: ${e.range || '-'}`,
    `- 存放方式: ${e.storage}`,
    `- 已提取: ${e.extracted || '-'}`,
    `- 备注: ${e.note || '-'}`,
    '',
  ].join('\n')
}

/** 重写所有条目小节（保留 frontmatter 与标题段，updated 刷新），并广播树刷新 */
function rewriteEntries(l: SourcesLayout, entries: SourceEntry[]): { ok: boolean; error?: string } {
  try {
    const fileAbs = join(l.rootPath, l.fileRel)
    const old = existsSync(fileAbs) ? readFileSync(fileAbs, 'utf-8') : emptyTemplate(l)
    const fm = /^---\n([\s\S]*?)\n---\n?/.exec(old)
    let head = '---\n' + (fm ? fm[1].split('\n').map(x => x.startsWith('updated:') ? `updated: ${today()}` : x).join('\n') : `workspace: ${l.wsName || '（未归一层）'}\nconversation: ${l.convName}\nupdated: ${today()}`) + '\n---\n'
    const body = entries.map(entryToBlock).join('\n')
    mkdirSync(l.dirAbs, { recursive: true })
    writeFileSync(fileAbs, `${head}\n# 素材来源登记\n\n${body}`, 'utf-8')
    broadcastTreeRefresh(l.dirRel)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

function readEntries(l: SourcesLayout): SourceEntry[] {
  const p = join(l.rootPath, l.fileRel)
  if (!existsSync(p)) return []
  try { return parseSourceMd(readFileSync(p, 'utf-8')) } catch { return [] }
}

// ===== 对外能力 =====

/** 读素材登记（首次读取自动生成空模板——3.13「创建对话时自动生成」的懒实现） */
export function readSources(sessionId: string, getSetting: (key: string) => unknown): SourcesResult {
  try {
    const l = layout(sessionId, getSetting, false)
    if ('error' in l) return { ok: false, error: l.error }
    const fileAbs = join(l.rootPath, l.fileRel)
    if (!existsSync(fileAbs)) {
      mkdirSync(l.dirAbs, { recursive: true })
      writeFileSync(fileAbs, emptyTemplate(l), 'utf-8')
      broadcastTreeRefresh(l.dirRel)
    }
    return { ok: true, relPath: l.fileRel, entries: readEntries(l) }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export interface AddSourceInput {
  name: string
  type: string
  /** 仅引用=直接存（URL/仓库相对/绝对路径）；已入库=作为素材文件的来源绝对路径 */
  path: string
  rangeFrom?: string
  rangeTo?: string
  storage: '已入库' | '仅引用'
  note?: string
}

/** 添加素材：已入库先拷贝原件进素材夹，再按模板追加条目（3-28「程序解析模板后写入」，非前端拼串） */
export function addSource(sessionId: string, input: AddSourceInput, getSetting: (key: string) => unknown): SourcesResult & { no?: number } {
  try {
    const name = String(input?.name ?? '').trim()
    if (!name) return { ok: false, error: '素材名称必填' }
    const type = TYPE_ENUM.includes((input?.type ?? '') as SourceType) ? String(input.type).toLowerCase() : 'other'
    const storage = input?.storage === '已入库' ? '已入库' : '仅引用'
    const l = layout(sessionId, getSetting, true)
    if ('error' in l) return { ok: false, error: l.error }
    mkdirSync(l.dirAbs, { recursive: true })
    let path = String(input.path ?? '').trim()
    if (storage === '已入库') {
      if (!path) return { ok: false, error: '入库失败：未选择素材文件' }
      const srcAbs = isAbsolute(path) || /^[a-zA-Z]:[\\/]/.test(path) ? path : join(l.rootPath, path)
      if (!existsSync(srcAbs)) return { ok: false, error: `入库失败：找不到文件 ${path}` }
      const copied = uniqueFileName(l.dirAbs, basename(srcAbs))
      copyFileSync(srcAbs, join(l.dirAbs, copied))
      path = `./${copied}`
    }
    const rf = parseInt(String(input.rangeFrom ?? ''), 10)
    const rt = parseInt(String(input.rangeTo ?? ''), 10)
    const range = Number.isFinite(rf) ? (Number.isFinite(rt) && rt >= rf ? `${rf}-${rt}` : `${rf}`) : '-'
    const entries = readEntries(l)
    const no = entries.reduce((m, e) => Math.max(m, e.no), 0) + 1
    const e: SourceEntry = { no, name, type, path, range, storage, extracted: '-', note: String(input.note ?? '').trim() }
    const w = rewriteEntries(l, [...entries, e])
    if (!w.ok) return { ok: false, error: w.error }
    return { ok: true, relPath: l.fileRel, entries: readEntries(l), no }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

/** 删除条目（编号定位；历史引用可能变化——保守只删该小节，其余编号不动） */
export function removeSource(sessionId: string, no: number, getSetting: (key: string) => unknown): SourcesResult {
  try {
    const l = layout(sessionId, getSetting, false)
    if ('error' in l) return { ok: false, error: l.error }
    const entries = readEntries(l)
    const next = entries.filter(e => e.no !== no)
    if (next.length === entries.length) return { ok: false, error: `没有编号为 ${no} 的素材条目` }
    const w = rewriteEntries(l, next)
    if (!w.ok) return { ok: false, error: w.error }
    return { ok: true, relPath: l.fileRel, entries: next }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** 解析条目路径 → 素材原件绝对路径（./名=素材夹；绝对路径原样；其余按仓库相对） */
function resolveMaterialAbs(l: SourcesLayout, p: string): string {
  const clean = p.trim()
  if (clean.startsWith('./')) return join(l.dirAbs, clean.slice(2))
  if (isAbsolute(clean) || /^[a-zA-Z]:[\\/]/.test(clean)) return clean
  return join(l.rootPath, clean)
}

function parseRange(r: string): { from: number; to: number } | null {
  const m = /^(\d+)\s*(?:-\s*(\d+))?$/.exec(r.trim())
  if (!m) return null
  const from = parseInt(m[1], 10)
  const to = m[2] ? parseInt(m[2], 10) : from
  if (!Number.isFinite(from) || from < 1 || to < from) return null
  return { from, to }
}

/**
 * 区间提取（3-26 防重复：已 ✓ 直接返回现有提取稿）：pdf/pptx 文本层逐页提取，
 * 生成 `{素材名}-p{起}-{终}.md`（3-30 命名拍板，与 SOURCE.md 同级、可编辑修正），回写「已提取」字段。
 * 公式/图表以文本层为准——视觉转写（3-21 手动）为后续增强，提取稿可编辑是其兜底。
 */
export async function extractRange(sessionId: string, no: number, getSetting: (key: string) => unknown): Promise<{ ok: boolean; relPath?: string; error?: string }> {
  try {
    const l = layout(sessionId, getSetting, false)
    if ('error' in l) return { ok: false, error: l.error }
    const entries = readEntries(l)
    const e = entries.find(x => x.no === no)
    if (!e) return { ok: false, error: `没有编号为 ${no} 的素材条目` }
    // 3-26 程序防重复：已 ✓ 直接返回现有提取稿（UI 也不出提取按钮，双保险）
    const ext = /^✓\s*→\s*(.+)$/.exec(e.extracted)
    if (ext) return { ok: true, relPath: `${l.dirRel}/${ext[1].trim()}` }
    if (e.type !== 'pdf' && e.type !== 'pptx') return { ok: false, error: '仅 pdf / pptx 支持区间提取' }
    const abs = resolveMaterialAbs(l, e.path)
    if (!e.path || e.path === '-' || !existsSync(abs)) return { ok: false, error: `素材原件不可用：${e.path || '（未登记路径）'}` }
    const rg = parseRange(e.range)
    if (!rg) return { ok: false, error: '页码区间未登记或格式非法（应为 起-止，如 12-34）' }
    const pages: { n: number; text: string }[] = e.type === 'pdf'
      ? (await extractPdfRange(abs, rg.from, rg.to)).pages
      : extractPptxPages(abs).filter(p => p.n >= rg.from && p.n <= rg.to)
    if (pages.length === 0) return { ok: false, error: '区间内没有可提取的页（扫描件/图片型内容请走视觉转写或手工整理，提取稿可直接编辑补录）' }
    const extractName = uniqueFileName(l.dirAbs, `${sanitizeTitle(e.name)}-p${rg.from}-${rg.to}.md`)
    const body = [
      `# ${e.name} · 第 ${rg.from}-${rg.to} 页提取稿`,
      '',
      `> 来源：${SOURCE_FILE} 素材 #${e.no}（${e.path}） · 提取于 ${today()} · 由文本层自动抽取`,
      '> 公式/图形以文本层为准可能失真；本页**可直接编辑修正**，AI 后续按修正版引用。',
      '',
      ...pages.flatMap(p => [`## p${p.n}`, '', p.text || '（本页无可提取文本）', '']),
    ].join('\n')
    writeFileSync(join(l.dirAbs, extractName), body, 'utf-8')
    const w = rewriteEntries(l, entries.map(x => x.no === e.no ? { ...x, extracted: `✓ → ${extractName}` } : x))
    if (!w.ok) return { ok: false, error: w.error }
    broadcastTreeRefresh(l.dirRel)
    return { ok: true, relPath: `${l.dirRel}/${extractName}` }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

/**
 * ── 3-21 视觉转写（手动档，后续增强）──────────────────────────────
 * 页位图由渲染层 pdf.js 栅格化（主进程无 canvas），主进程负责：
 * ① 把已入库/引用的 pdf 原件字节交给渲染层；② 逐页喂视觉模型转写；③ **非破坏式并入提取稿**
 *（已有 `## p{n}` 文本小节保留，转写块追补在文末「视觉转写」节；无提取稿则以转写新建并回写 已提取 ✓）。
 */
export function readSourceBytes(sessionId: string, no: number, getSetting: (key: string) => unknown): { ok: boolean; base64?: string; error?: string } {
  try {
    const l = layout(sessionId, getSetting, false)
    if ('error' in l) return { ok: false, error: l.error }
    const e = readEntries(l).find(x => x.no === no)
    if (!e) return { ok: false, error: `没有编号为 ${no} 的素材条目` }
    if (e.type !== 'pdf') return { ok: false, error: '视觉转写当前仅支持 pdf 原件（pptx 页渲染需 Office 引擎）' }
    const abs = resolveMaterialAbs(l, e.path)
    if (!e.path || e.path === '-' || !existsSync(abs)) return { ok: false, error: `素材原件不可用：${e.path || '（未登记路径）'}` }
    const st = statSync(abs)
    if (st.size > 80 * 1024 * 1024) return { ok: false, error: `原件过大（${Math.round(st.size / 1048576)}MB > 80MB），请缩小区间` }
    return { ok: true, base64: readFileSync(abs).toString('base64') }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

const VISION_SYSTEM = '你是教材视觉转写助手。把你收到的教材页面图片**逐元素忠实转写**为结构化 Markdown：'
  + '公式一律用 LaTeX（行内 $…$，独立公式 $$…$$）；表格转 Markdown 表格；图片/几何图给一句【图：…】客观描述；'
  '保留标题层级与题号。只转写页面上实际可见的内容，看不清就标注（不清晰），**严禁编造或补全**。直接输出该页 Markdown，不要任何开场白或评论。'

/** 逐页转写并并入提取稿。pages = 渲染层栅格化的 {n 页码, dataUrl}（≤12 页，单页失败不中断其余） */
export async function transcribeVision(sessionId: string, no: number, pages: { n: number; dataUrl: string }[], getSetting: (key: string) => unknown): Promise<{ ok: boolean; relPath?: string; model?: string; done?: number[]; failed?: number[]; error?: string }> {
  try {
    const l = layout(sessionId, getSetting, false)
    if ('error' in l) return { ok: false, error: l.error }
    const entries = readEntries(l)
    const e = entries.find(x => x.no === no)
    if (!e) return { ok: false, error: `没有编号为 ${no} 的素材条目` }
    const list = (Array.isArray(pages) ? pages : []).filter(p => Number.isFinite(p.n) && typeof p.dataUrl === 'string' && p.dataUrl.startsWith('data:image/')).slice(0, 12)
    if (list.length === 0) return { ok: false, error: '没有可用的页面位图（渲染失败？请重试）' }
    const done: { n: number; md: string }[] = []
    const failed: number[] = []
    let model = ''
    for (const p of list) {
      const r = await visionChat({ system: VISION_SYSTEM, prompt: `这是教材第 ${p.n} 页，请转写整页。`, images: [p.dataUrl] })
      const t = (r.text ?? '').trim()
      if (r.ok && t) { done.push({ n: p.n, md: t }); model = r.model ?? model }
      else failed.push(p.n)
    }
    if (done.length === 0) return { ok: false, failed, error: failed.length ? `全部页转写失败（视觉模型不可用或不支持图片输入）：${model || ''}` : '转写失败' }
    // 并入提取稿：已有则文末追补「视觉转写」节（保留文本层与用户手工修正）；没有则以转写新建提取稿并回写 ✓ 指针
    const ext = /^✓\s*→\s*(.+)$/.exec(e.extracted)
    let extName = ext ? ext[1].trim() : ''
    const block = ['', `## 视觉转写（${model} · ${today()} · 3-21）`, '', ...done.flatMap(d => [`### p${d.n}`, '', d.md, ''])].join('\n')
    if (extName && existsSync(join(l.dirAbs, extName))) {
      const old = readFileSync(join(l.dirAbs, extName), 'utf-8')
      writeFileSync(join(l.dirAbs, extName), `${old.replace(/\s+$/, '')}\n\n${block}`, 'utf-8')
    } else {
      const rg = { from: Math.min(...done.map(d => d.n)), to: Math.max(...done.map(d => d.n)) }
      extName = uniqueFileName(l.dirAbs, `${sanitizeTitle(e.name)}-p${rg.from}-${rg.to}.md`)
      const body = [
        `# ${e.name} · 第 ${rg.from}-${rg.to} 页提取稿（视觉转写）`,
        '',
        `> 来源：${SOURCE_FILE} 素材 #${e.no}（${e.path}） · ${today()} · 由视觉模型逐页转写（3-21），文本层缺失/失真时的忠实版`,
        '> 本页**可直接编辑修正**，AI 后续按修正版引用。',
        '',
        ...done.flatMap(d => [`## p${d.n}`, '', d.md, '']),
      ].join('\n')
      writeFileSync(join(l.dirAbs, extName), body, 'utf-8')
      const w = rewriteEntries(l, entries.map(x => x.no === e.no ? { ...x, extracted: `✓ → ${extName}` } : x))
      if (!w.ok) return { ok: false, error: w.error }
    }
    broadcastTreeRefresh(l.dirRel)
    return { ok: true, relPath: `${l.dirRel}/${extName}`, model, done: done.map(d => d.n), failed }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

/**
 * AgentRunner 注入（每轮重读，与 CONSTRAINTS 同哲学）：素材目录 + 编号制引用规则（3-29）。
 * 无登记文件/零条目 → 空串（零注入，存量会话不受扰）。
 */
export function resolveSourcesForInjection(sessionId: string, getSetting: (key: string) => unknown): string {
  try {
    const l = layout(sessionId, getSetting, false)
    if ('error' in l) return ''
    const entries = readEntries(l)
    if (entries.length === 0) return ''
    const lines = entries.slice(0, 60).map(e => {
      const bits = [`类型 ${e.type}`, `路径 ${e.path || '-'}`]
      if (e.range && e.range !== '-') bits.push(`页码区间 ${e.range}`)
      const ext = /^✓\s*→\s*(.+)$/.exec(e.extracted)
      bits.push(ext ? `**提取稿 ${l.dirRel}/${ext[1].trim()}（优先读此文件）**` : '未提取')
      return `- [${e.no}] ${e.name}（${bits.join(' · ')}）${e.note ? ` 备注：${e.note}` : ''}`
    })
    const hint = [
      '【素材目录（本对话 SOURCE.md，实时读取）】用户登记的素材如下。需要使用素材内容时：',
      '有「提取稿」的条目优先 vault 读提取稿（文本已按页码区间抽取、可编辑）；未提取的 pdf/pptx 可提示用户',
      '在右栏「素材库」点提取，或仅按登记信息回答。引用素材内容时行内标注编号与页码，形如 [1] p.15；',
      '每条回答末尾附「本次引用素材」清单（仅列实际用到的：编号. 名称 · 页码/URL）。用户要求登记素材时，',
      `按模板直接编辑 ${l.fileRel}（### 编号. 名称 + 固定字段行）。`,
      ...lines,
    ].join('\n')
    return hint.length > 3500 ? hint.slice(0, 3500) + '\n…（素材目录过长已截断，全量见 SOURCE.md）' : hint
  } catch {
    return ''
  }
}

/** IPC 注册（main/index.ts settingsCache 注入） */
export function registerAiTeachingSourceHandlers(getSetting: (key: string) => unknown): void {
  ipcMain.handle('aiTeachSrc:read', (_e, sessionId: string) => readSources(String(sessionId ?? ''), getSetting))
  ipcMain.handle('aiTeachSrc:add', (_e, sessionId: string, input: AddSourceInput) => addSource(String(sessionId ?? ''), input, getSetting))
  ipcMain.handle('aiTeachSrc:remove', (_e, sessionId: string, no: number) => removeSource(String(sessionId ?? ''), Number(no), getSetting))
  ipcMain.handle('aiTeachSrc:extract', (_e, sessionId: string, no: number) => extractRange(String(sessionId ?? ''), Number(no), getSetting))
  // 3-21 视觉转写（手动档）：原件字节交给渲染层栅格化；转写结果并入提取稿
  ipcMain.handle('aiTeachSrc:pdfBytes', (_e, sessionId: string, no: number) => readSourceBytes(String(sessionId ?? ''), Number(no), getSetting))
  ipcMain.handle('aiTeachSrc:transcribe', async (_e, sessionId: string, no: number, pages: { n: number; dataUrl: string }[]) => {
    const list = Array.isArray(pages) ? pages.map(p => ({ n: Number(p?.n), dataUrl: String(p?.dataUrl ?? '') })) : []
    return transcribeVision(String(sessionId ?? ''), Number(no), list, getSetting)
  })
  // 入库浏览：系统文件选择器（表单「已入库」用；返回绝对路径给 add 拷贝）
  ipcMain.handle('aiTeachSrc:pick', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null
    const r = await dialog.showOpenDialog(win, {
      title: '选择要入库的素材文件',
      properties: ['openFile'],
      filters: [
        { name: '素材（文档/演示/图片/文本）', extensions: ['pdf', 'pptx', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'md', 'txt', 'docx'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    })
    return r.canceled || r.filePaths.length === 0 ? { ok: true, path: null } : { ok: true, path: r.filePaths[0] }
  })
}
