import { app, ipcMain, net, dialog, BrowserWindow } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'fs'
import { join, resolve, sep } from 'path'
import { unzipBuffer } from './zip'
import { safePathInside } from './pathGuard'
import { isNewerVersion } from './updateService'

/**
 * 插件注册表与安装管理(一期:声明式插件,无代码执行)。
 *
 * 插件包 = zip(根目录含 plugin.json);安装后落盘 userData/plugins/<id>/,
 * 状态(启用/禁用/安装时间)记录在 userData/plugins/installed.json。
 * 安全边界:下载域名白名单 / Zip Slip 防护 / manifest 严格校验 / 体积与文件数上限。
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
const KNOWN_CONTRIBUTIONS = ['blogTemplates', 'theme', 'habitPresets', 'bookmarkPresets', 'pomodoroPresets', 'helpDocs']

export interface PluginManifest {
  id: string
  name: string
  version: string
  engineVersion?: string
  author?: string
  description?: string
  type: 'declarative' | 'code'
  activation?: string[]
  contributes?: Record<string, unknown>
}

interface InstalledEntry { id: string; version: string; enabled: boolean; installedAt: string }
type InstalledIndex = Record<string, InstalledEntry>

export interface PluginSummary {
  id: string
  name: string
  version: string
  engineVersion?: string
  author?: string
  description?: string
  type: string
  enabled: boolean
  installedAt: string
  contributions: string[]
  broken?: boolean
}

// ---------- 存储 ----------

function pluginsDir(): string {
  const dir = join(app.getPath('userData'), 'plugins')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function indexPath(): string {
  return join(pluginsDir(), 'installed.json')
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

function validateManifest(m: unknown): { manifest: PluginManifest } | { error: string } {
  if (!m || typeof m !== 'object') return { error: 'plugin.json 不是有效的 JSON 对象' }
  const raw = m as Record<string, unknown>
  if (typeof raw.id !== 'string' || !ID_RE.test(raw.id)) return { error: '插件 id 缺失或格式非法(仅允许小写字母/数字/. _ -)' }
  if (typeof raw.name !== 'string' || !raw.name.trim() || raw.name.length > 50) return { error: '插件 name 缺失或过长' }
  if (typeof raw.version !== 'string' || !VER_RE.test(raw.version)) return { error: '插件 version 缺失或格式非法(需 x.y.z)' }
  if (raw.type === 'code') return { error: '暂不支持代码插件(type: code)' }
  if (raw.type !== undefined && raw.type !== 'declarative') return { error: `未知的插件类型: ${String(raw.type)}` }
  if (raw.description !== undefined && (typeof raw.description !== 'string' || raw.description.length > 300)) return { error: 'description 过长' }
  if (raw.author !== undefined && (typeof raw.author !== 'string' || raw.author.length > 50)) return { error: 'author 过长' }
  if (raw.contributes !== undefined) {
    if (typeof raw.contributes !== 'object' || raw.contributes === null || Array.isArray(raw.contributes)) return { error: 'contributes 必须是对象' }
    for (const key of Object.keys(raw.contributes)) {
      if (!KNOWN_CONTRIBUTIONS.includes(key)) return { error: `不支持的贡献类型: ${key}` }
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

function readManifestAt(pluginDir: string): { manifest: PluginManifest } | { error: string } {
  const manifestPath = join(pluginDir, 'plugin.json')
  if (!existsSync(manifestPath)) return { error: '插件目录缺少 plugin.json' }
  const buf = readFileSync(manifestPath)
  if (buf.length > MAX_MANIFEST_BYTES) return { error: 'plugin.json 过大' }
  let parsed: unknown
  try { parsed = JSON.parse(buf.toString('utf-8')) } catch { return { error: 'plugin.json 不是有效的 JSON' } }
  return validateManifest(parsed)
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

function installFromBuffer(buf: Buffer): { success: true; manifest: PluginManifest } | { success: false; message: string } {
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

  // id 即目录名(已通过正则校验,无路径成分)
  const pluginDir = join(pluginsDir(), manifest.id)
  const inside = safePathInside(pluginsDir(), manifest.id)
  if (!inside || resolve(inside) !== resolve(pluginDir)) return { success: false, message: '插件 id 非法' }

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

  // 登记(保留原安装时间)
  const idx = readIndex()
  idx[manifest.id] = {
    id: manifest.id,
    version: manifest.version,
    enabled: true,
    installedAt: idx[manifest.id]?.installedAt || new Date().toISOString(),
  }
  writeIndex(idx)
  console.log(`[Plugins] 已安装插件 ${manifest.id}@${manifest.version}`)
  return { success: true, manifest }
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
      registryCache = { data, fetchedAt: now }
      return { ok: true, plugins: data.plugins, updatedAt: data.updatedAt ?? '' }
    } catch (e: any) {
      return { ok: false, plugins: [], message: e?.message || String(e) }
    }
  })

  ipcMain.handle('plugin:install', async (_e, url: string) => {
    try {
      if (typeof url !== 'string' || !isTrustedUrl(url)) return { success: false, message: '下载地址不受信任(仅允许 GitHub)' }
      const buf = await fetchBufferWithMirrors(url, { 'User-Agent': 'Knowbase-App' })
      return installFromBuffer(buf)
    } catch (e: any) {
      return { success: false, message: `安装失败: ${e?.message || e}` }
    }
  })

  ipcMain.handle('plugin:installFromFile', async () => {
    try {
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      if (!win) return { success: false, message: '无可用的应用窗口' }
      const result = await dialog.showOpenDialog(win, {
        title: '安装插件(选择插件 zip 包)',
        filters: [{ name: '插件包 (ZIP)', extensions: ['zip'] }],
        properties: ['openFile']
      })
      if (result.canceled || result.filePaths.length === 0) return { success: false, message: '已取消' }
      return installFromBuffer(readFileSync(result.filePaths[0]))
    } catch (e: any) {
      return { success: false, message: `安装失败: ${e?.message || e}` }
    }
  })

  ipcMain.handle('plugin:getContribution', (_e, id: string, key: string) => {
    if (typeof id !== 'string' || !ID_RE.test(id)) return { ok: false, message: '插件 id 非法' }
    if (typeof key !== 'string' || !KNOWN_CONTRIBUTIONS.includes(key)) return { ok: false, message: '贡献类型非法' }
    const dir = safePathInside(pluginsDir(), id)
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
      const pluginDir = join(pluginsDir(), id)
      const parsed = existsSync(pluginDir) ? readManifestAt(pluginDir) : { error: '插件目录不存在' }
      if ('error' in parsed) {
        out.push({ id, name: id, version: entry.version, type: 'declarative', enabled: false, installedAt: entry.installedAt, contributions: [], broken: true })
        continue
      }
      const m = parsed.manifest
      out.push({
        id: m.id, name: m.name, version: m.version, engineVersion: m.engineVersion,
        author: m.author, description: m.description, type: m.type,
        enabled: entry.enabled, installedAt: entry.installedAt,
        contributions: m.contributes ? Object.keys(m.contributes) : [],
      })
    }
    return out
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
    const dir = safePathInside(pluginsDir(), id)
    if (!dir) return { success: false, message: '插件 id 非法' }
    try { if (existsSync(dir)) rmSync(dir, { recursive: true, force: true }) } catch (e: any) {
      return { success: false, message: `删除插件目录失败: ${e?.message || e}` }
    }
    const idx = readIndex()
    delete idx[id]
    writeIndex(idx)
    return { success: true }
  })
}
