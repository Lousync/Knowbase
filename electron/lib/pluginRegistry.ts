import { app, ipcMain, net, dialog, BrowserWindow } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, cpSync, readdirSync } from 'fs'
import { join, resolve, sep } from 'path'
import { randomUUID } from 'crypto'
import { unzipBuffer } from './zip'
import { safePathInside } from './pathGuard'
import { isNewerVersion } from './updateService'
import { getDatabase, saveToDisk } from '../database/connection'

/**
 * 插件注册表与安装管理。
 * 安全分级:S(内容级,纯静态) / A(数据级,经主进程枚举动作写库) / B(能力级,UI 沙箱 + 桥)。
 * 判级由主进程强算(防骗标);code 类型在清单校验阶段拒收。
 */

const REGISTRY_MIRRORS = [
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
// 贡献类型白名单(automationRule 为 Tier1 数据级预留)
const KNOWN_CONTRIBUTIONS = ['blogTemplates', 'theme', 'habitPresets', 'bookmarkPresets', 'pomodoroPresets', 'helpDocs', 'tools', 'automationRule']
// 安全分级:S=内容级(纯静态) / A=数据级(写库) / B=能力级(UI 沙箱+桥)
export type RiskLevel = 'S' | 'A' | 'B'
const LEVEL_RANK: Record<RiskLevel, number> = { S: 0, A: 1, B: 2 }
// 数据级贡献键(命中即为 A 级)
const DATA_LEVEL_KEYS = ['habitPresets', 'bookmarkPresets', 'automationRule']
// 内容级贡献键(仅含这些为 S 级)
const CONTENT_LEVEL_KEYS = ['theme', 'blogTemplates', 'helpDocs', 'pomodoroPresets']
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
  riskLevel?: RiskLevel
  capabilities?: string[]
  activation?: string[]
  contributes?: Record<string, unknown>
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
function auditWrite(pluginId: string, action: string, detail: unknown): void {
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
  const list = [url]
  const m = /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/.exec(url)
  if (m) {
    const [, owner, repo, branch, path] = m
    list.push(`https://cdn.jsdelivr.net/gh/${owner}/${repo}@${branch}/${path}`)
    list.push(`https://fastly.jsdelivr.net/gh/${owner}/${repo}@${branch}/${path}`)
  }
  return list
}

/** 依次尝试所有镜像,任一成功即返回;全部失败抛最后一个错误 */
async function fetchBufferWithMirrors(url: string, headers: Record<string, string>): Promise<Buffer> {
  let lastErr: unknown = null
  for (const u of mirrorCandidates(url)) {
    try {
      const res = await fetchWithTimeout(u, headers)
      if (!res.ok) { lastErr = new Error(`${new URL(u).hostname} 返回 ${res.status}`); continue }
      return Buffer.from(await res.arrayBuffer())
    } catch (e) { lastErr = e }
  }
  throw lastErr ?? new Error('所有下载源均不可达')
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
  if (buf.length === 0 || buf.length > MAX_PACKAGE_BYTES) {
    return { success: false, message: `插件包大小超出限制(最大 ${Math.round(MAX_PACKAGE_BYTES / 1048576)}MB)` }
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
    if (data.length > MAX_PACKAGE_BYTES) return { success: false, message: '插件包含超大文件,已中止安装' }
    fileCount++
    if (fileCount > MAX_FILE_COUNT) return { success: false, message: `插件文件数超出限制(最大 ${MAX_FILE_COUNT})` }
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
  return { success: true, manifest, riskLevel, isUpdate }
}

function readManifestFromBuffer(buf: Buffer): { manifest: PluginManifest } | { error: string } {
  if (buf.length > MAX_MANIFEST_BYTES) return { error: 'plugin.json 过大' }
  try {
    return validateManifest(JSON.parse(buf.toString('utf-8')))
  } catch { return { error: 'plugin.json 不是有效的 JSON' } }
}

// ---------- IPC ----------

export function registerPluginHandlers(): void {
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
      const buf = await fetchBufferWithMirrors(url, { 'User-Agent': 'Knowbase-App' })
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
    return { success: true }
  })

  // 内置插件落位:随应用分发的官方插件,首次运行(或目录缺失)时复制到插件目录
  try {
    const builtinDir = app.isPackaged
      ? join(process.resourcesPath, 'builtin-plugins')
      : join(app.getAppPath(), 'resources', 'builtin-plugins')
    if (existsSync(builtinDir)) {
      const idx = readIndex()
      let changed = false
      for (const ent of readdirSync(builtinDir, { withFileTypes: true })) {
        if (!ent.isDirectory()) continue
        const mfPath = join(builtinDir, ent.name, 'plugin.json')
        if (!existsSync(mfPath)) continue
        const parsed = readManifestFromBuffer(readFileSync(mfPath))
        if ('error' in parsed) { console.warn(`[Plugins] 内置插件清单非法(${ent.name}):`, parsed.error); continue }
        const id = parsed.manifest.id
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
      if (changed) writeIndex(idx)
    }
  } catch (err) {
    console.error('[Plugins] 内置插件落位失败:', err)
  }
}
