import { app, ipcMain, net, dialog, BrowserWindow } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, cpSync, readdirSync } from 'fs'
import { join, resolve, sep } from 'path'
import { randomUUID } from 'crypto'
import { unzipBuffer } from './zip'
import { safePathInside } from './pathGuard'
import { isNewerVersion } from './updateService'
import { getDatabase, saveToDisk } from '../database/connection'
import { getPackState, importPack } from './knowledgePackImporter'

/**
 * 插件注册表与安装管理。
 * 安全分级:S(内容级,纯静态) / A(数据级,经主进程枚举动作写库) / B(能力级,UI 沙箱 + 桥)。
 * 判级由主进程强算(防骗标);code 类型在清单校验阶段拒收。
 */

/** 插件下载/registry 镜像默认值 — 与 src/lib/settings.ts updateMirror 及 updateService 保持一致 */
const DEFAULT_PLUGIN_MIRROR = 'https://gh.dpik.top'
let pluginSettingReader: (key: string) => unknown = () => undefined

/** 用户配置的 ghproxy 前缀镜像(gh.dpik.top 等);未配置过用默认,显式空串=不用 */
function userGhMirror(): string | null {
  const raw = pluginSettingReader('updateMirror')
  let s: string
  if (raw === undefined || raw === null) s = DEFAULT_PLUGIN_MIRROR
  else { s = String(raw).trim().replace(/\/+$/, ''); if (!s) return null }
  return /^https:\/\/[\w.-]+(:\d+)?$/.test(s) ? s : null
}

// registry 拉取顺序:ghproxy 节点(实时性好,jsDelivr CDN 缓存可达 24h 会给陈旧列表) → raw → jsDelivr
const REGISTRY_MIRRORS = [
  `${DEFAULT_PLUGIN_MIRROR}/https://raw.githubusercontent.com/Lousync/Knowbase-plugins/main/registry.json`,
  'https://raw.githubusercontent.com/Lousync/Knowbase-plugins/main/registry.json',
  'https://cdn.jsdelivr.net/gh/Lousync/Knowbase-plugins@main/registry.json',
  'https://fastly.jsdelivr.net/gh/Lousync/Knowbase-plugins@main/registry.json',
]
// 下载镜像:raw 失败时自动改走 jsDelivr 的 GitHub 镜像(国内可达性好)
const TRUSTED_HOSTS = new Set([
  'github.com', 'objects.githubusercontent.com', 'raw.githubusercontent.com', 'codeload.github.com',
  'cdn.jsdelivr.net', 'fastly.jsdelivr.net', 'gcore.jsdelivr.net',
])
const MAX_PACKAGE_BYTES = 20 * 1024 * 1024   // 单个插件包上限
const MAX_FILE_COUNT = 500                    // 单插件文件数上限
const MAX_MANIFEST_BYTES = 256 * 1024         // manifest 上限
const ID_RE = /^[a-z0-9][a-z0-9._-]*$/
const VER_RE = /^\d+\.\d+\.\d+/
const ENTRY_RE = /^[\w][\w.-]{0,64}\.html$/
const ICON_RE = /^[\w][\w.-]{0,64}\.(svg|png|jpg|jpeg|webp|gif)$/i
const KNOWN_CONTRIBUTIONS = ['blogTemplates', 'theme', 'habitPresets', 'bookmarkPresets', 'pomodoroPresets', 'helpDocs', 'tools', 'skills', 'automationRule', 'knowledgePages', 'sidebarIcons', 'deleteFx']
/** Skill 变量名规则（提示词 {{var}} 占位符） */
const SKILL_VAR_RE = /^[a-zA-Z_][a-zA-Z0-9_]{0,30}$/
/** Skill 声明依赖的工具名（命名空间规则与 ToolRegistry 一致，一期仅展示不校验执行权） */
const SKILL_TOOL_REF_RE = /^[a-z][a-z0-9]*(\.[a-z0-9][a-z0-9._-]*)*$/
// 安全分级:S=内容级(纯静态) / A=数据级(写库) / B=能力级(UI 沙箱+桥)
export type RiskLevel = 'S' | 'A' | 'B'
const LEVEL_RANK: Record<RiskLevel, number> = { S: 0, A: 1, B: 2 }
// 数据级贡献键(命中即为 A 级)
const DATA_LEVEL_KEYS = ['habitPresets', 'bookmarkPresets', 'automationRule', 'knowledgePages']
// 内容级贡献键(仅含这些为 S 级)
const CONTENT_LEVEL_KEYS = ['theme', 'blogTemplates', 'helpDocs', 'pomodoroPresets', 'skills', 'sidebarIcons', 'deleteFx']
// UI 插件能力白名单(一期发布值;data.* 预留语法本期不放行)
const KNOWN_CAPABILITIES = ['theme', 'clipboard']

export interface PluginManifest {
  id: string
  name: string
  version: string
  engineVersion?: string
  author?: string
  description?: string
  type: 'declarative' | 'ui' | 'code'
  entry?: string
  icon?: string
  category?: string
  riskLevel?: RiskLevel
  capabilities?: string[]
  activation?: string[]
  contributes?: Record<string, unknown>
}

/** 删除动画皮肤（插件 contributes.deleteFx，纯数据 S 级） */
export interface DeleteFxSkin {
  pluginId?: string
  id?: string
  name?: string
  /** SVG 片段（注入 <svg> 内，禁脚本/事件） */
  dragonSvg?: string
  /** 粒子颜色（#RRGGBB 等） */
  particleColors?: string[]
  /** 吞噬遮罩颜色 */
  wipeColor?: string
  /** 动画时长 ms（300-2000） */
  durationMs?: number
}

interface InstalledEntry { id: string; version: string; enabled: boolean; installedAt: string; builtin?: boolean; userRemoved?: boolean; riskLevel?: RiskLevel; grantedCapabilities?: string[]; grantedAt?: string }
type InstalledIndex = Record<string, InstalledEntry>

export interface PluginSummary {
  id: string
  name: string
  version: string
  engineVersion?: string
  author?: string
  description?: string
  type: string
  entry?: string
  icon?: string
  category?: string
  riskLevel: RiskLevel
  capabilities: string[]
  grantedCapabilities: string[]
  legacyGrant?: boolean
  enabled: boolean
  installedAt: string
  builtin?: boolean
  contributions: string[]
  broken?: boolean
}

/** 插件根目录(userData/plugins) */
export function getPluginsRoot(): string {
  const dir = join(app.getPath('userData'), 'plugins')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

/** 插件图标访问地址(经 plugin:// 协议;无图标返回 null) */
export function pluginIconUrl(id: string, icon?: string): string | null {
  if (!icon || !ICON_RE.test(icon)) return null
  return `plugin://${id}/${icon}`
}

function indexPath(): string {
  return join(getPluginsRoot(), 'installed.json')
}

function readIndex(): InstalledIndex {
  try {
    if (!existsSync(indexPath())) return {}
    return JSON.parse(readFileSync(indexPath(), 'utf-8')) as InstalledIndex
  } catch { return {} }
}

function writeIndex(idx: InstalledIndex): void {
  try {
    writeFileSync(indexPath(), JSON.stringify(idx, null, 2), 'utf-8')
  } catch (err) {
    console.error('[Plugins] 写入 installed.json 失败:', err)
  }
}

/** 已安装索引只读快照（供 Skill 等派生消费方遍历启用状态） */
export function getInstalledIndex(): InstalledIndex {
  return readIndex()
}

// ---------- manifest 校验 ----------

function validateManifest(m: unknown, opts?: { legacy?: boolean }): { manifest: PluginManifest } | { error: string } {
  if (!m || typeof m !== 'object') return { error: 'plugin.json 不是有效的 JSON 对象' }
  const raw = m as Record<string, unknown>
  if (typeof raw.id !== 'string' || !ID_RE.test(raw.id)) return { error: '插件 id 缺失或格式非法(仅允许小写字母/数字/. _ -)' }
  if (typeof raw.name !== 'string' || !raw.name.trim() || raw.name.length > 50) return { error: '插件 name 缺失或过长' }
  if (typeof raw.version !== 'string' || !VER_RE.test(raw.version)) return { error: '插件 version 缺失或格式非法(需 x.y.z)' }
  if (raw.type === 'code') return { error: '暂不支持代码插件(type: code)' }
  if (raw.type !== 'ui' && raw.type !== 'declarative') return { error: `未知的插件类型: ${String(raw.type)}` }
  if (raw.type === 'ui') {
    if (typeof raw.entry !== 'string' || !ENTRY_RE.test(raw.entry)) {
      return { error: 'UI 插件必须提供 entry(入口 HTML 文件名,如 index.html)' }
    }
  }
  if (raw.icon !== undefined) {
    if (typeof raw.icon !== 'string' || !ICON_RE.test(raw.icon)) return { error: 'icon 必须是包内图片文件名(svg/png/jpg/webp/gif)' }
  }
  if (raw.category !== undefined) {
    if (typeof raw.category !== 'string' || !raw.category.trim() || raw.category.length > 20) return { error: 'category 需为 1-20 字符的分类名' }
  }
  if (raw.riskLevel !== undefined) {
    if (typeof raw.riskLevel !== 'string' || !['S', 'A', 'B'].includes(raw.riskLevel)) return { error: 'riskLevel 仅允许 S / A / B' }
  }
  if (raw.capabilities !== undefined) {
    if (raw.type !== 'ui') return { error: 'capabilities 仅 UI 插件(type: ui)可声明' }
    if (!Array.isArray(raw.capabilities) || raw.capabilities.length > 10) return { error: 'capabilities 必须是数组(最多 10 项)' }
    for (const c of raw.capabilities) {
      if (typeof c !== 'string' || !KNOWN_CAPABILITIES.includes(c)) {
        return { error: `未声明的能力: ${String(c)}(当前支持: ${KNOWN_CAPABILITIES.join(' / ')})` }
      }
    }
  } else if (raw.type === 'ui') {
    // 旧版容忍模式(仅用于读取已安装的存量插件):按等价现状补默认授权
    if (!opts?.legacy) return { error: 'UI 插件必须声明 capabilities(可为空数组 = 零能力)' }
    raw.capabilities = ['theme', 'clipboard']
  }
  if (raw.description !== undefined && (typeof raw.description !== 'string' || raw.description.length > 300)) return { error: 'description 过长' }
  if (raw.author !== undefined && (typeof raw.author !== 'string' || raw.author.length > 50)) return { error: 'author 过长' }
  if (raw.contributes !== undefined) {
    if (typeof raw.contributes !== 'object' || raw.contributes === null || Array.isArray(raw.contributes)) return { error: 'contributes 必须是对象' }
    for (const key of Object.keys(raw.contributes)) {
      if (!KNOWN_CONTRIBUTIONS.includes(key)) return { error: `不支持的贡献类型: ${key}` }
      if (key === 'tools' && raw.type !== 'ui') return { error: 'tools 贡献仅 UI 插件(type: ui)可声明' }
      if (key === 'knowledgePages') {
        const kp = (raw.contributes as Record<string, unknown>).knowledgePages
        if (!kp || typeof kp !== 'object' || Array.isArray(kp)) return { error: 'knowledgePages 必须是对象' }
        const k = kp as Record<string, unknown>
        // v2(空间优先多笔记本):{ space, notebooks:[{ name, coverColor?, chapters[] }] }
        // v1(单笔记本):{ notebook, coverColor?, chapters[] }
        let chapterLists: unknown[][] = []
        if (Array.isArray(k.notebooks)) {
          if (k.notebooks.length === 0 || k.notebooks.length > 20) return { error: 'notebooks 需为 1-20 个笔记本' }
          for (const nb of k.notebooks as Record<string, unknown>[]) {
            if (!nb || typeof nb !== 'object') return { error: '笔记本条目非法' }
            if (typeof nb.name !== 'string' || !nb.name.trim() || nb.name.length > 50) return { error: '笔记本 name 缺失或过长' }
            if (nb.coverColor !== undefined && (typeof nb.coverColor !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(nb.coverColor))) return { error: 'coverColor 需为 #RRGGBB' }
            chapterLists.push(nb.chapters)
          }
          if (k.space !== undefined && (typeof k.space !== 'string' || !k.space.trim() || k.space.length > 60)) return { error: 'space 缺失或过长(≤60 字符)' }
        } else {
          if (typeof k.notebook !== 'string' || !k.notebook.trim() || k.notebook.length > 50) return { error: 'knowledgePages.notebook 缺失或过长' }
          if (k.coverColor !== undefined && (typeof k.coverColor !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(k.coverColor))) return { error: 'coverColor 需为 #RRGGBB' }
          chapterLists = [k.chapters]
        }
        let pageTotal = 0
        for (const chapters of chapterLists) {
          if (!Array.isArray(chapters) || chapters.length === 0 || chapters.length > 50) return { error: 'chapters 需为 1-50 个章节' }
          for (const ch of chapters as Record<string, unknown>[]) {
            if (!ch || typeof ch !== 'object') return { error: '章节条目非法' }
            if (typeof ch.name !== 'string' || !ch.name.trim() || ch.name.length > 50) return { error: '章节 name 缺失或过长' }
            if (!Array.isArray(ch.pages) || ch.pages.length === 0 || ch.pages.length > 500) return { error: `章节「${ch.name}」页面数需为 1-500` }
            for (const pg of ch.pages as Record<string, unknown>[]) {
              pageTotal++
              if (pageTotal > 1500) return { error: '页面总数超出限制(最大 1500),请拆包' }
              if (!pg || typeof pg !== 'object') return { error: '页面条目非法' }
              if (typeof pg.file !== 'string' || !/^[\w][\w\-./ ]{0,150}\.md$/i.test(pg.file) || String(pg.file).includes('..')) return { error: `页面 file 路径非法: ${String(pg.file)}` }
              if (typeof pg.title !== 'string' || !pg.title.trim() || pg.title.length > 100) return { error: '页面 title 缺失或过长' }
              if (typeof pg.externalId !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(pg.externalId)) return { error: '页面 externalId 缺失或非法' }
              if (pg.tags !== undefined && (!Array.isArray(pg.tags) || pg.tags.length > 10 || pg.tags.some((t: unknown) => typeof t !== 'string' || String(t).length > 20))) return { error: '页面 tags 非法(最多 10 个、每个 20 字符)' }
            }
          }
        }
      }
      if (key === 'deleteFx') {
        // 删除动画皮肤：纯数据（SVG 龙头 + 颜色 + 时长），S 级内容贡献
        const fx = (raw.contributes as Record<string, unknown>).deleteFx
        if (!fx || typeof fx !== 'object' || Array.isArray(fx)) return { error: 'deleteFx 必须是对象' }
        const f = fx as Record<string, unknown>
        if (f.name !== undefined && (typeof f.name !== 'string' || !f.name.trim() || f.name.length > 40)) return { error: 'deleteFx.name 缺失或过长' }
        if (f.dragonSvg !== undefined) {
          if (typeof f.dragonSvg !== 'string' || f.dragonSvg.length > 16 * 1024) return { error: 'deleteFx.dragonSvg 需为 ≤16KB 的 SVG 片段' }
          if (/<script|<\/script|on\w+\s*=|javascript:/i.test(f.dragonSvg)) return { error: 'deleteFx.dragonSvg 含危险内容' }
        }
        if (f.particleColors !== undefined) {
          if (!Array.isArray(f.particleColors) || f.particleColors.length === 0 || f.particleColors.length > 12) return { error: 'deleteFx.particleColors 需为 1-12 个颜色' }
          if (f.particleColors.some((c: unknown) => typeof c !== 'string' || !/^#[0-9a-fA-F]{3,8}$/.test(c))) return { error: 'deleteFx.particleColors 颜色格式非法' }
        }
        if (f.wipeColor !== undefined && (typeof f.wipeColor !== 'string' || !/^#[0-9a-fA-F]{3,8}$/.test(f.wipeColor))) return { error: 'deleteFx.wipeColor 需为颜色值' }
        if (f.durationMs !== undefined && (typeof f.durationMs !== 'number' || f.durationMs < 300 || f.durationMs > 2000)) return { error: 'deleteFx.durationMs 需在 300-2000 之间' }
      }
      if (key === 'tools') {
        const tools = (raw.contributes as Record<string, unknown>).tools
        if (!Array.isArray(tools) || tools.length === 0 || tools.length > 10) return { error: 'tools 必须是非空数组(最多 10 个)' }
        for (const t of tools) {
          const tt = t as Record<string, unknown>
          if (!tt || typeof tt !== 'object') return { error: 'tools 条目非法' }
          if (typeof tt.id !== 'string' || !ID_RE.test(tt.id)) return { error: 'tools 条目 id 非法' }
          if (typeof tt.name !== 'string' || !tt.name.trim() || tt.name.length > 30) return { error: 'tools 条目 name 缺失或过长' }
        }
      }
      if (key === 'skills') {
        // AI 技能包：纯声明式提示词资产（分级上属 A 级数据贡献族，见 tiers 文档）
        const skills = (raw.contributes as Record<string, unknown>).skills
        if (!Array.isArray(skills) || skills.length === 0 || skills.length > 20) return { error: 'skills 必须是非空数组(最多 20 个)' }
        for (const s of skills) {
          const sk = s as Record<string, unknown>
          if (!sk || typeof sk !== 'object') return { error: 'skills 条目非法' }
          if (typeof sk.id !== 'string' || !ID_RE.test(sk.id)) return { error: 'skills 条目 id 非法' }
          if (typeof sk.title !== 'string' || !sk.title.trim() || sk.title.length > 60) return { error: 'skills 条目 title 缺失或过长' }
          if (typeof sk.prompt !== 'string' || !sk.prompt.trim()) return { error: 'skills 条目 prompt 缺失' }
          if (sk.prompt.length > 8000) return { error: 'skills 条目 prompt 过长(最大 8000 字符)' }
          if (sk.description !== undefined && (typeof sk.description !== 'string' || sk.description.length > 300)) return { error: 'skills 条目 description 过长' }
          if (sk.variables !== undefined) {
            if (!Array.isArray(sk.variables) || sk.variables.length > 10) return { error: 'skills variables 必须是数组(最多 10 个)' }
            for (const v of sk.variables) {
              if (typeof v !== 'string' || !SKILL_VAR_RE.test(v)) return { error: `skills 变量名非法: ${String(v)}` }
            }
          }
          if (sk.tools !== undefined) {
            if (!Array.isArray(sk.tools) || sk.tools.length > 10) return { error: 'skills tools 必须是数组(最多 10 个)' }
            for (const t of sk.tools) {
              if (typeof t !== 'string' || !SKILL_TOOL_REF_RE.test(t)) return { error: `skills 声明的工具名非法: ${String(t)}` }
            }
          }
        }
      }
    }
  } else {
    return { error: '插件缺少 contributes(没有任何可提供的内容)' }
  }
  // 兼容性检查:engineVersion 形如 ">=2.7.0"
  if (raw.engineVersion !== undefined) {
    const match = /^>=(\d+\.\d+\.\d+)$/.exec(String(raw.engineVersion))
    if (!match) return { error: 'engineVersion 格式非法(需 ">=x.y.z")' }
    if (isNewerVersion(match[1], app.getVersion())) {
      return { error: `该插件需要应用版本 >= ${match[1]},请先更新应用` }
    }
  }
  return { manifest: raw as unknown as PluginManifest }
}

// ---------- 安全分级 ----------

/** 主进程强算等级(防骗标):ui→B;含数据级贡献→A;仅内容级贡献→S */
function computeRiskLevel(m: PluginManifest): RiskLevel {
  if (m.type === 'ui') return 'B'
  const keys = Object.keys(m.contributes || {})
  if (keys.some(k => DATA_LEVEL_KEYS.includes(k))) return 'A'
  return 'S'
}

const RANK = (l: RiskLevel) => LEVEL_RANK[l]

/** 最终等级 = max(自报值, 计算值),序 S < A < B */
export function effectiveRiskLevel(m: PluginManifest): RiskLevel {
  const computed = computeRiskLevel(m)
  if (m.riskLevel && LEVEL_RANK[m.riskLevel] > LEVEL_RANK[computed]) return m.riskLevel
  return computed
}

/** 策略开关:允许安装/启用的等级集合(settings.json → pluginAllowedLevels) */
function getAllowedLevels(): Set<string> {
  try {
    const sp = join(app.getPath('userData'), 'settings.json')
    if (existsSync(sp)) {
      const s = JSON.parse(readFileSync(sp, 'utf-8'))
      const raw = typeof s.pluginAllowedLevels === 'string' ? s.pluginAllowedLevels : 'S,A,B'
      const set = new Set(raw.split(',').map(x => x.trim().toUpperCase()).filter(x => ['S', 'A', 'B'].includes(x)))
      if (set.size > 0) return set
    }
  } catch { /* ignore */ }
  return new Set(['S', 'A', 'B'])
}

/** 行为审计 */
export function auditWrite(pluginId: string, action: string, detail: unknown): void {
  try {
    getDatabase().run(
      'INSERT INTO plugin_audit_log (id, plugin_id, action, detail) VALUES (?, ?, ?, ?)',
      [randomUUID(), pluginId, action, JSON.stringify(detail ?? {})]
    )
    saveToDisk()
  } catch (e) {
    console.error('[Plugins] 审计写入失败:', e)
  }
}

function readManifestAt(pluginDir: string, legacy = false): { manifest: PluginManifest } | { error: string } {
  const manifestPath = join(pluginDir, 'plugin.json')
  if (!existsSync(manifestPath)) return { error: '插件目录缺少 plugin.json' }
  const buf = readFileSync(manifestPath)
  if (buf.length > MAX_MANIFEST_BYTES) return { error: 'plugin.json 过大' }
  let parsed: unknown
  try { parsed = JSON.parse(buf.toString('utf-8')) } catch { return { error: 'plugin.json 不是有效的 JSON' } }
  return validateManifest(parsed, { legacy })
}

// ---------- 注册表 ----------

let registryCache: { data: any; fetchedAt: number } | null = null
const REGISTRY_TTL = 10 * 60 * 1000

function isTrustedUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && TRUSTED_HOSTS.has(u.hostname)
  } catch { return false }
}

/** 带超时的 fetch(15 秒,防单点挂起拖垮整个回退链) */
async function fetchWithTimeout(url: string, headers: Record<string, string>): Promise<Response> {
  return net.fetch(url, { headers, signal: AbortSignal.timeout(15000) })
}

/** raw.githubusercontent URL → jsDelivr 镜像候选列表 */
function mirrorCandidates(url: string): string[] {
  const list: string[] = []
  const m = userGhMirror()
  if (m) list.push(`${m}/${url}`) // ghproxy 前缀协议,raw 与 release 资产均适用
  list.push(url)
  const r = /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/.exec(url)
  if (r) {
    const [, owner, repo, branch, path] = r
    list.push(`https://cdn.jsdelivr.net/gh/${owner}/${repo}@${branch}/${path}`)
    list.push(`https://fastly.jsdelivr.net/gh/${owner}/${repo}@${branch}/${path}`)
  }
  return list
}

/**
 * 流式下载插件包:连接超时 20 秒、正文不限总时长(60 秒无数据看门狗防死挂),
 * 下载进度经 onChunk 上报 —— 大内容包不再被"整请求 15 秒超时"误杀。
 */
async function downloadZipStreaming(
  url: string,
  headers: Record<string, string>,
  onProgress: (received: number, total: number) => void
): Promise<Buffer> {
  const ctrl = new AbortController()
  // 连接阶段超时:响应头到达即解除(正文交给空闲看门狗);30s 宽容慢节点
  let connectTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => ctrl.abort(), 30000)
  const res = await net.fetch(url, { headers, signal: ctrl.signal })
  try { if (connectTimer) { clearTimeout(connectTimer); connectTimer = null } } catch { /* ignore */ }
  if (!res.ok || !res.body) throw new Error(`${new URL(url).hostname} 返回 ${res.status}`)
  if (/text\/html/i.test(String(res.headers.get('content-type') || ''))) throw new Error(`${new URL(url).hostname} 返回网页而非文件`)

  const total = Number(res.headers.get('content-length') || 0)
  const chunks: Buffer[] = []
  let received = 0
  let lastEmit = Date.now()
  // 正文空闲看门狗:每次收到数据重置;60 秒无数据判定为死链
  let idleTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => ctrl.abort(), 60000)
  const touchIdle = () => {
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null }
    idleTimer = setTimeout(() => ctrl.abort(), 60000)
  }
  try {
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      const buf = Buffer.from(chunk)
      chunks.push(buf)
      received += buf.length
      touchIdle()
      // 进度节流:≥1% 或 ≥300ms 推一次;结束必推
      const now = Date.now()
      const pct = total > 0 ? (received / total) * 100 : -1
      if (now - lastEmit >= 300 || pct >= 100) {
        lastEmit = now
        onProgress(received, total)
      }
    }
  } finally {
    if (connectTimer) clearTimeout(connectTimer)
    if (idleTimer) clearTimeout(idleTimer)
  }
  onProgress(received, total)
  return Buffer.concat(chunks)
}

async function fetchRegistryRaw(): Promise<any> {
  let lastErr: unknown = null
  for (const url of REGISTRY_MIRRORS) {
    try {
      const res = await fetchWithTimeout(url, { Accept: 'application/vnd.github+json', 'User-Agent': 'Knowbase-App' })
      if (!res.ok) { lastErr = new Error(`${new URL(url).hostname} 返回 ${res.status}`); continue }
      const data = await res.json()
      if (!data || !Array.isArray(data.plugins)) throw new Error('registry.json 格式非法')
      return data
    } catch (e) { lastErr = e }
  }
  throw lastErr ?? new Error('所有插件仓库镜像均不可达,请检查网络后重试')
}

// ---------- 安装 ----------

function installFromBuffer(buf: Buffer, grantedCapabilities?: string[]): { success: true; manifest: PluginManifest; riskLevel: RiskLevel; isUpdate: boolean } | { success: false; message: string } {
  // 绝对上限(内容型插件放宽到 60MB,精确限额在 manifest 解析后判定)
  if (buf.length === 0 || buf.length > 60 * 1024 * 1024) {
    return { success: false, message: '插件包为空或超出 60MB 上限' }
  }
  let files: Map<string, Buffer>
  try { files = unzipBuffer(buf) } catch (e: any) { return { success: false, message: `插件包解压失败: ${e?.message || e}` } }

  // 定位 manifest:根目录或单层顶层目录(兼容系统压缩工具打包)
  let prefix = ''
  let manifestEntry: string | null = files.has('plugin.json') ? 'plugin.json' : null
  if (!manifestEntry) {
    for (const p of files.keys()) {
      if (/^[^/\\]+[/\\]plugin\.json$/.test(p)) { manifestEntry = p; prefix = p.slice(0, -'plugin.json'.length); break }
    }
  }
  if (!manifestEntry) return { success: false, message: '插件包根目录缺少 plugin.json' }

  const parsed = readManifestFromBuffer(files.get(manifestEntry)!)
  if ('error' in parsed) return { success: false, message: parsed.error }
  const manifest = parsed.manifest

  // 限额:内容型插件(knowledgePages)单独放宽(60MB / 1500 文件),其余沿用通用值
  const isKnowledgePack = Boolean(manifest.contributes?.knowledgePages)
  const maxBytes = isKnowledgePack ? 60 * 1024 * 1024 : MAX_PACKAGE_BYTES
  const maxFiles = isKnowledgePack ? 1500 : MAX_FILE_COUNT
  if (buf.length > maxBytes) {
    return { success: false, message: `插件包大小超出限制(最大 ${Math.round(maxBytes / 1048576)}MB)` }
  }

  // 安全分级:主进程强算 + 自报取高(防骗标)
  const riskLevel = effectiveRiskLevel(manifest)

  // 策略开关:不允许的等级直接拦截
  const allowed = getAllowedLevels()
  if (!allowed.has(riskLevel)) {
    return { success: false, message: `策略限制:当前仅允许安装 ${[...allowed].sort().join(' / ')} 级插件,该插件为 ${riskLevel} 级` }
  }

  // UI 插件:入口 HTML 必须存在于包内;图标文件同理
  if (manifest.type === 'ui') {
    const entryKey = prefix + manifest.entry!
    if (!files.has(entryKey)) return { success: false, message: `UI 插件入口文件缺失: ${manifest.entry}` }
  }
  if (manifest.icon && !files.has(prefix + manifest.icon)) {
    return { success: false, message: `图标文件缺失: ${manifest.icon}` }
  }

  // id 即目录名(已通过正则校验,无路径成分)
  const pluginDir = join(getPluginsRoot(), manifest.id)
  const inside = safePathInside(getPluginsRoot(), manifest.id)
  if (!inside || resolve(inside) !== resolve(pluginDir)) return { success: false, message: '插件 id 非法' }

  const isUpdate = Boolean(readIndex()[manifest.id])

  // 逐条目落盘(防 Zip Slip + 数量/体积限制)
  let fileCount = 0
  for (const [entryPath, data] of files) {
    const normalized = entryPath.replace(/\\/g, '/')
    if (normalized.endsWith('/')) continue                       // 目录条目
    if (prefix && !normalized.startsWith(prefix)) continue        // 只取插件目录内的内容
    const rel = prefix ? normalized.slice(prefix.length) : normalized
    if (!rel) continue
    const dest = safePathInside(pluginDir, rel)
    if (!dest) return { success: false, message: `插件包含非法路径条目: ${rel}(已中止安装)` }
    if (data.length > maxBytes) return { success: false, message: '插件包含超大文件,已中止安装' }
    fileCount++
    if (fileCount > maxFiles) return { success: false, message: `插件文件数超出限制(最大 ${maxFiles})` }
    mkdirSync(resolve(dest, '..'), { recursive: true })
    writeFileSync(dest, data)
  }

  // 登记(保留原安装时间;UI 插件持久化用户授权的能力)
  const idx = readIndex()
  const granted = manifest.type === 'ui'
    ? (grantedCapabilities ?? []).filter(c => (manifest.capabilities || []).includes(c))
    : undefined
  idx[manifest.id] = {
    id: manifest.id,
    version: manifest.version,
    enabled: true,
    installedAt: idx[manifest.id]?.installedAt || new Date().toISOString(),
    riskLevel,
    ...(manifest.type === 'ui' ? { grantedCapabilities: granted, grantedAt: new Date().toISOString() } : {}),
  }
  writeIndex(idx)
  auditWrite(manifest.id, isUpdate ? 'update' : 'install', { version: manifest.version, riskLevel, granted: granted ?? null })
  console.log(`[Plugins] 已安装插件 ${manifest.id}@${manifest.version} (${riskLevel} 级)`)
  notifyPluginsChanged()
  return { success: true, manifest, riskLevel, isUpdate }
}

function readManifestFromBuffer(buf: Buffer): { manifest: PluginManifest } | { error: string } {
  if (buf.length > MAX_MANIFEST_BYTES) return { error: 'plugin.json 过大' }
  try {
    return validateManifest(JSON.parse(buf.toString('utf-8')))
  } catch { return { error: 'plugin.json 不是有效的 JSON' } }
}

// ---------- 变更通知（供 Skill 等消费方同步派生状态） ----------

const changeSubscribers: Array<() => void> = []

/** 订阅插件集合/启用状态变化（安装、卸载、启停、内置落位后触发） */
export function onPluginsChanged(cb: () => void): void {
  changeSubscribers.push(cb)
}

function notifyPluginsChanged(): void {
  for (const cb of changeSubscribers) {
    try { cb() } catch (err) { console.error('[Plugins] 变更订阅回调失败:', err) }
  }
}

// ---------- IPC ----------

export function registerPluginHandlers(deps?: { getSettingValue?: (key: string) => unknown }): void {
  if (deps?.getSettingValue) pluginSettingReader = deps.getSettingValue
  ipcMain.handle('plugin:fetchRegistry', async () => {
    try {
      const now = Date.now()
      if (registryCache && now - registryCache.fetchedAt < REGISTRY_TTL) {
        return { ok: true, plugins: registryCache.data.plugins, updatedAt: registryCache.data.updatedAt ?? '' }
      }
      const data = await fetchRegistryRaw()
      // 策略开关:过滤掉不允许的等级(条目未标 riskLevel 视为 S)
      const allowed = getAllowedLevels()
      const plugins = (data.plugins as any[]).filter(p => !p.riskLevel || allowed.has(String(p.riskLevel).toUpperCase()))
      registryCache = { data: { ...data, plugins }, fetchedAt: now }
      return { ok: true, plugins, updatedAt: data.updatedAt ?? '' }
    } catch (e: any) {
      return { ok: false, plugins: [], message: e?.message || String(e) }
    }
  })

  ipcMain.handle('plugin:install', async (_e, url: string, grantedCapabilities?: unknown) => {
    try {
      if (typeof url !== 'string' || !isTrustedUrl(url)) return { success: false, message: '下载地址不受信任(仅允许 GitHub)' }
      const push = (received: number, total: number, host = '') => {
        const pct = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : -1
        for (const w of BrowserWindow.getAllWindows()) {
          if (!w.isDestroyed()) w.webContents.send('plugin:download-progress', { key: url, received, total, percent: pct, host })
        }
      }
      push(0, 0)
      // 大包友好:流式下载(连接 30s/空闲 60s 看门狗),镜像候选含 ghproxy 前缀节点;
      // 区域性瞬时拦截常表现为全候选连续 404/RESET → 整轮退避重试(间隔 2s/6s)
      let buf: Buffer | null = null
      const diag: string[] = []
      let usedHost = ''
      outer:
      for (let round = 0; round < 3 && !buf; round++) {
        if (round > 0) await new Promise(r => setTimeout(r, round === 1 ? 2000 : 6000))
        for (const u of mirrorCandidates(url)) {
          try {
            buf = await downloadZipStreaming(u, { 'User-Agent': 'Knowbase-App' }, (r, t) => {
              try { push(r, t, new URL(u).hostname) } catch { /* ignore */ }
            })
            usedHost = new URL(u).hostname
            break outer
          } catch (e) {
            const msg = `${new URL(u).hostname}: ${String(e?.message || e).slice(0, 60)}`
            if (!diag.includes(msg)) diag.push(msg)
            push(0, 0, usedHost) /* 切换下一候选,进度归零 */
          }
        }
      }
      if (!buf) throw new Error(`所有下载源均失败(已重试 3 轮) —— ${diag.join('; ')}`)
      push(buf.length, buf.length, usedHost)
      const grants = Array.isArray(grantedCapabilities) ? grantedCapabilities.filter((c): c is string => typeof c === 'string') : undefined
      return installFromBuffer(buf, grants)
    } catch (e: any) {
      return { success: false, message: `安装失败: ${e?.message || e}` }
    }
  })

  ipcMain.handle('plugin:installFromFile', async (_e, grantedCapabilities?: unknown) => {
    try {
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      if (!win) return { success: false, message: '无可用的应用窗口' }
      const result = await dialog.showOpenDialog(win, {
        title: '安装插件(选择插件 zip 包)',
        filters: [{ name: '插件包 (ZIP)', extensions: ['zip'] }],
        properties: ['openFile']
      })
      if (result.canceled || result.filePaths.length === 0) return { success: false, message: '已取消' }
      const grants = Array.isArray(grantedCapabilities) ? grantedCapabilities.filter((c): c is string => typeof c === 'string') : undefined
      return installFromBuffer(readFileSync(result.filePaths[0]), grants)
    } catch (e: any) {
      return { success: false, message: `安装失败: ${e?.message || e}` }
    }
  })

  ipcMain.handle('plugin:listDeleteFxSkins', (): DeleteFxSkin[] => {
    // 删除动画皮肤聚合：所有已启用且声明 deleteFx 的插件
    const idx = readIndex()
    const out: DeleteFxSkin[] = []
    for (const [id, entry] of Object.entries(idx)) {
      if (!entry.enabled) continue
      const dir = safePathInside(getPluginsRoot(), id)
      if (!dir || !existsSync(dir)) continue
      const parsed = readManifestAt(dir)
      if ('error' in parsed) continue
      const fx = (parsed.manifest.contributes as Record<string, unknown> | undefined)?.deleteFx as Record<string, unknown> | undefined
      if (!fx || typeof fx !== 'object') continue
      out.push({
        pluginId: id,
        id: typeof fx.id === 'string' && fx.id.trim() ? fx.id : id,
        name: typeof fx.name === 'string' && fx.name.trim() ? fx.name : parsed.manifest.name,
        dragonSvg: typeof fx.dragonSvg === 'string' ? fx.dragonSvg : undefined,
        particleColors: Array.isArray(fx.particleColors) ? fx.particleColors.filter((c: unknown): c is string => typeof c === 'string') : undefined,
        wipeColor: typeof fx.wipeColor === 'string' ? fx.wipeColor : undefined,
        durationMs: typeof fx.durationMs === 'number' ? fx.durationMs : undefined,
      })
    }
    return out
  })

  ipcMain.handle('plugin:getContribution', (_e, id: string, key: string) => {
    if (typeof id !== 'string' || !ID_RE.test(id)) return { ok: false, message: '插件 id 非法' }
    if (typeof key !== 'string' || !KNOWN_CONTRIBUTIONS.includes(key)) return { ok: false, message: '贡献类型非法' }
    const dir = safePathInside(getPluginsRoot(), id)
    if (!dir || !existsSync(dir)) return { ok: false, message: '插件未安装' }
    const idx = readIndex()
    if (!idx[id]?.enabled) return { ok: false, message: '插件已禁用,请先启用' }
    const parsed = readManifestAt(dir)
    if ('error' in parsed) return { ok: false, message: parsed.error }
    const data = (parsed.manifest.contributes as Record<string, unknown> | undefined)?.[key]
    if (data === undefined) return { ok: false, message: '该插件未包含此内容' }
    if (JSON.stringify(data).length > 1024 * 1024) return { ok: false, message: '贡献内容过大' }
    return { ok: true, data }
  })

  ipcMain.handle('plugin:listInstalled', (): PluginSummary[] => {
    const idx = readIndex()
    const out: PluginSummary[] = []
    for (const [id, entry] of Object.entries(idx)) {
      const pluginDir = join(getPluginsRoot(), id)
      // 存量已装插件走 legacy 容忍(旧清单无 capabilities 等新字段)
      const parsed = existsSync(pluginDir) ? readManifestAt(pluginDir, true) : { error: '插件目录不存在' }
      if ('error' in parsed) {
        out.push({ id, name: id, version: entry.version, type: 'declarative', enabled: false, installedAt: entry.installedAt, riskLevel: entry.riskLevel || 'S', capabilities: [], grantedCapabilities: [], contributions: [], broken: true, builtin: entry.builtin })
        continue
      }
      const m = parsed.manifest
      const level = entry.riskLevel && LEVEL_RANK[entry.riskLevel] >= LEVEL_RANK[effectiveRiskLevel(m)] ? entry.riskLevel : effectiveRiskLevel(m)
      const legacyGrant = m.type === 'ui' && !entry.grantedCapabilities
      out.push({
        id: m.id, name: m.name, version: m.version, engineVersion: m.engineVersion,
        author: m.author, description: m.description, type: m.type, entry: m.entry,
        icon: pluginIconUrl(m.id, m.icon) || undefined,
        category: m.category,
        riskLevel: level,
        capabilities: m.capabilities || [],
        grantedCapabilities: m.type === 'ui' ? (entry.grantedCapabilities || m.capabilities || []) : [],
        legacyGrant: legacyGrant || undefined,
        enabled: entry.enabled, installedAt: entry.installedAt, builtin: entry.builtin,
        contributions: m.contributes ? Object.keys(m.contributes) : [],
      })
    }
    return out
  })

  // 授权变更(B 级能力勾选/撤销)
  ipcMain.handle('plugin:setGranted', (_e, id: string, caps: unknown) => {
    if (typeof id !== 'string' || !ID_RE.test(id)) return { success: false, message: '插件 id 非法' }
    if (!Array.isArray(caps)) return { success: false, message: '参数非法' }
    const idx = readIndex()
    if (!idx[id]) return { success: false, message: '插件未安装' }
    const pluginDir = join(getPluginsRoot(), id)
    const parsed = existsSync(pluginDir) ? readManifestAt(pluginDir, true) : { error: 'x' as const }
    if ('error' in parsed) return { success: false, message: '插件数据损坏' }
    const declared = parsed.manifest.capabilities || []
    const granted = caps.filter((c): c is string => typeof c === 'string' && declared.includes(c))
    idx[id].grantedCapabilities = granted
    idx[id].grantedAt = new Date().toISOString()
    writeIndex(idx)
    auditWrite(id, 'grant', { granted })
    return { success: true }
  })

  // 行为审计:列表 / 清空 / 渲染层写入(A 级导入、B 级拒绝等)
  ipcMain.handle('plugin:auditList', (_e, id: string | undefined) => {
    const db = getDatabase()
    const rows: { id: string; plugin_id: string; action: string; detail: string; created_at: string }[] = []
    const stmt = id
      ? db.prepare('SELECT id, plugin_id, action, detail, created_at FROM plugin_audit_log WHERE plugin_id = ? ORDER BY created_at DESC LIMIT 20')
      : db.prepare('SELECT id, plugin_id, action, detail, created_at FROM plugin_audit_log ORDER BY created_at DESC LIMIT 20')
    if (id) stmt.bind([id])
    while (stmt.step()) rows.push(stmt.getAsObject() as typeof rows[number])
    stmt.free()
    return rows.map(r => ({ id: r.id, pluginId: r.plugin_id, action: r.action, detail: r.detail, createdAt: r.created_at }))
  })

  ipcMain.handle('plugin:auditClear', (_e, id: string | undefined) => {
    const db = getDatabase()
    if (id) db.run('DELETE FROM plugin_audit_log WHERE plugin_id = ?', [id])
    else db.run('DELETE FROM plugin_audit_log')
    saveToDisk()
    return { success: true }
  })

  ipcMain.handle('plugin:auditWrite', (_e, id: string, action: string, detail: unknown) => {
    if (typeof id !== 'string' || !ID_RE.test(id)) return { success: false }
    if (typeof action !== 'string' || !['import', 'deny', 'run', 'grant'].includes(action)) return { success: false }
    auditWrite(id, action, detail)
    return { success: true }
  })

  ipcMain.handle('plugin:setEnabled', (_e, id: string, enabled: boolean) => {
    if (typeof id !== 'string' || !ID_RE.test(id)) return { success: false, message: '插件 id 非法' }
    const idx = readIndex()
    if (!idx[id]) return { success: false, message: '插件未安装' }
    idx[id].enabled = Boolean(enabled)
    writeIndex(idx)
    notifyPluginsChanged()
    return { success: true }
  })

  ipcMain.handle('plugin:uninstall', (_e, id: string) => {
    if (typeof id !== 'string' || !ID_RE.test(id)) return { success: false, message: '插件 id 非法' }
    const idx = readIndex()
    if (!idx[id]) return { success: false, message: '插件未安装' }
    if (idx[id].builtin) return { success: false, message: '内置插件不可卸载,可改为禁用' }
    const dir = safePathInside(getPluginsRoot(), id)
    if (!dir) return { success: false, message: '插件 id 非法' }
    try { if (existsSync(dir)) rmSync(dir, { recursive: true, force: true }) } catch (e: any) {
      return { success: false, message: `删除插件目录失败: ${e?.message || e}` }
    }
    auditWrite(id, 'uninstall', { version: idx[id].version })
    delete idx[id]
    writeIndex(idx)
    notifyPluginsChanged()
    return { success: true }
  })

  // 内容型插件(knowledgePages):导入状态与执行
  ipcMain.handle('knowledgePack:getImportState', (_e, pluginId: string) => {
    // 禁用即停:禁用态下导入状态锁定为 disabled,更新通道一并关闭
    const idx = readIndex()
    if (idx[pluginId] && !idx[pluginId].enabled) {
      return { ok: true, state: 'disabled', message: '插件已禁用,请先在插件页启用' }
    }
    return getPackState(pluginId)
  })
  ipcMain.handle('knowledgePack:importPack', (_e, pluginId: string, overwriteModified: boolean, forceExternalIds?: unknown) => {
    const idx = readIndex()
    if (idx[pluginId] && !idx[pluginId].enabled) {
      return { ok: false, message: '插件已禁用,请先启用后再导入' }
    }
    const r = importPack(pluginId, Boolean(overwriteModified), Array.isArray(forceExternalIds) ? forceExternalIds.map(String) : undefined)
    return r
  })

  // 内置插件落位:随应用分发的官方插件,首次运行(或目录缺失)时复制到插件目录
  try {
    // 打包版在 resources 下;开发版从应用路径探测——直接以 js 文件启动时 getAppPath() 可能指向
    // out/main,需向工程根回溯,否则内置插件永远找不到(存量缺陷)
    const builtinCandidates = app.isPackaged
      ? [join(process.resourcesPath, 'builtin-plugins')]
      : [
          join(app.getAppPath(), 'resources', 'builtin-plugins'),
          resolve(app.getAppPath(), '../..', 'resources', 'builtin-plugins'),
          join(process.cwd(), 'resources', 'builtin-plugins'),
        ]
    const builtinDir = builtinCandidates.find(p => existsSync(p))
    if (builtinDir) {
      const idx = readIndex()
      const builtinIds = new Set<string>()
      let changed = false
      for (const ent of readdirSync(builtinDir, { withFileTypes: true })) {
        if (!ent.isDirectory()) continue
        const mfPath = join(builtinDir, ent.name, 'plugin.json')
        if (!existsSync(mfPath)) continue
        const parsed = readManifestFromBuffer(readFileSync(mfPath))
        if ('error' in parsed) { console.warn(`[Plugins] 内置插件清单非法(${ent.name}):`, parsed.error); continue }
        const id = parsed.manifest.id
        builtinIds.add(id)
        if (idx[id]?.userRemoved) continue          // 用户明确卸载过,不再自动恢复
        const dest = join(getPluginsRoot(), id)
        // 未安装 → 复制;已安装但内置版本更新 → 覆盖升级(内置插件随应用发版更新)
        const needInstall = !existsSync(dest) || (idx[id] && isNewerVersion(parsed.manifest.version, idx[id].version))
        if (!needInstall) continue
        cpSync(join(builtinDir, ent.name), dest, { recursive: true, force: true })
        const level = effectiveRiskLevel(parsed.manifest)
        idx[id] = {
          id, version: parsed.manifest.version,
          enabled: idx[id]?.enabled ?? true,
          installedAt: idx[id]?.installedAt || new Date().toISOString(),
          builtin: true, riskLevel: level,
          // 内置 UI 插件:官方出品,按清单全量预授权
          ...(parsed.manifest.type === 'ui' ? { grantedCapabilities: parsed.manifest.capabilities || [], grantedAt: new Date().toISOString() } : {}),
        }
        changed = true
        console.log(`[Plugins] 内置插件已就位: ${id}@${parsed.manifest.version}${existsSync(dest) ? '(升级)' : ''}`)
      }
      // 存量清理:已不再随应用分发的内置插件,降级为普通插件(解锁卸载,如强密码生成器转市场)
      for (const [id, entry] of Object.entries(idx)) {
        if (entry.builtin && !builtinIds.has(id)) {
          idx[id] = { ...entry, builtin: false }
          changed = true
          console.log(`[Plugins] 内置插件已转为普通插件(可卸载): ${id}`)
        }
      }
      if (changed) writeIndex(idx)
      if (changed) notifyPluginsChanged()
    }
  } catch (err) {
    console.error('[Plugins] 内置插件落位失败:', err)
  }
}
