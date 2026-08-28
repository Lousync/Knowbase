import { app, ipcMain, shell, BrowserWindow, net } from 'electron'
import { createWriteStream, existsSync, mkdirSync, statSync, unlinkSync } from 'fs'
import { join, resolve } from 'path'
import { createHash } from 'crypto'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'

/**
 * 应用更新检查/下载 —— 基于 GitHub Releases。
 * 检查:releases/latest API 对比本地 app.getVersion();
 * 下载:主进程流式下载安装包到系统"下载"目录,进度实时推送渲染层;
 *       优先走设置里的镜像前缀(updateMirror,ghproxy 协议 https://镜像/https://github.com/...),
 *       失效自动回退直连;安装:运行下载好的安装包。
 */

const REPO = 'Lousync/Knowbase'
const API_LATEST = `https://api.github.com/repos/${REPO}/releases/latest`
const RELEASES_PAGE = `https://github.com/${REPO}/releases`

/** 设置读取器(registerUpdateHandlers 注入) */
let getSettingValue: (key: string) => unknown = () => undefined

/**
 * 镜像默认值 — 与 src/lib/settings.ts 的 updateMirror 默认值保持一致。
 * 主进程读的是原始 settings.json 缓存,未写过该 key 时拿不到渲染层注册表的默认值,
 * 故此处兜底;用户显式置空字符串 = 强制直连。
 */
const DEFAULT_UPDATE_MIRROR = 'https://gh.dpik.top'

/** 规范化用户配置的镜像前缀:非法返回 null(空串视为直连) */
function resolveMirror(): string | null {
  const raw = getSettingValue('updateMirror')
  let s: string
  if (raw === undefined || raw === null) s = DEFAULT_UPDATE_MIRROR // 从未配置过 → 用默认镜像
  else { s = String(raw).trim().replace(/\/+$/, ''); if (!s) return null } // 显式空串 = 直连
  if (!/^https:\/\/[\w.-]+(:\d+)?$/.test(s)) return null
  return s
}

/** 已知可用的 ghproxy 节点(下载速度与缓存健康度不定,作为用户镜像之后的兜底候选) */
const FALLBACK_MIRRORS = ['https://gh.dpik.top', 'https://gh-proxy.com', 'https://cdn.gh-proxy.com']

/**
 * 由已通过白名单校验的 GitHub URL 构造下载候选列表:
 * [用户镜像, 备用镜像..., 直连] —— 镜像在前保速度,直连兜底保可用;
 * 配合下载后的 sha512 校验,任何节点返回坏字节都会被识别并自动换下一候选。
 */
function downloadCandidates(url: string): string[] {
  const mirror = resolveMirror()
  const list: string[] = []
  if (mirror) list.push(`${mirror}/${url}`)
  for (const m of FALLBACK_MIRRORS) {
    if (m !== mirror) list.push(`${m}/${url}`)
  }
  list.push(url)
  return list
}

export interface UpdateAsset { name: string; url: string; size: number }

export interface UpdateCheckResult {
  ok: boolean
  hasUpdate: boolean
  currentVersion: string
  latestVersion: string
  releaseUrl: string
  notes: string
  asset: UpdateAsset | null
  message?: string
}

function normalizeVersion(v: string): number[] {
  const cleaned = v.trim().replace(/^v/i, '').split('-')[0]
  return cleaned.split('.').map(n => parseInt(n, 10) || 0)
}

/** semver 比较:latest 是否比 current 新(供插件更新检查复用) */
export function isNewerVersion(latest: string, current: string): boolean {
  return isNewer(latest, current)
}

function isNewer(latest: string, current: string): boolean {
  const a = normalizeVersion(latest)
  const b = normalizeVersion(current)
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) > (b[i] ?? 0)) return true
    if ((a[i] ?? 0) < (b[i] ?? 0)) return false
  }
  return false
}

/** 从 release 资产里挑安装包:优先 Windows .exe 安装程序,其次 .zip,再次第一个资产 */
function pickAsset(assets: any[]): UpdateAsset | null {
  if (!Array.isArray(assets) || assets.length === 0) return null
  const byExt = (ext: string) => assets.find(a => typeof a?.name === 'string' && a.name.toLowerCase().endsWith(ext))
  const picked = byExt('.exe') || byExt('.zip') || assets[0]
  if (!picked?.browser_download_url) return null
  return { name: String(picked.name), url: String(picked.browser_download_url), size: Number(picked.size) || 0 }
}

function pushProgress(percent: number, receivedBytes: number, totalBytes: number): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('update:download-progress', { percent, receivedBytes, totalBytes })
  }
}

/** 慢速保护:15s 内收到的字节不足 2MB(≈136KB/s)判定为慢通道,放弃换下一候选 */
const SLOW_WINDOW_MS = 15000
const SLOW_MIN_BYTES = 2 * 1024 * 1024

/** 从单通道下载到 dest,流式推送进度;失败抛出(由上层换通道) */
async function downloadOne(candidate: string, dest: string, expectedSize?: number): Promise<void> {
  const r = await net.fetch(candidate, { headers: { 'User-Agent': 'Knowbase-App' }, redirect: 'follow' })
  const ctype = String(r.headers.get('content-type') || '')
  if (!r.ok || !r.body) throw new Error(`${new URL(candidate).hostname} HTTP ${r.status}`)
  if (/text\/html/i.test(ctype)) throw new Error(`${new URL(candidate).hostname} 返回的是网页而非文件`)
  const total = Number(r.headers.get('content-length') || 0)
  // 大小前置校验:content-length 与期望不符 → 直接判坏字节,避免白下载整包
  if (expectedSize && total > 0 && total !== expectedSize) {
    throw new Error(`文件大小不符(期望 ${expectedSize},实际 ${total}),疑似坏字节`)
  }
  const out = createWriteStream(dest)
  let received = 0
  let lastPct = -1
  let slowTimer: NodeJS.Timeout | null = null
  const reader = Readable.fromWeb(r.body as import('stream/web').ReadableStream)
  reader.on('data', (chunk: Buffer) => {
    received += chunk.length
    const pct = total > 0 ? Math.round((received / total) * 100) : 0
    if (pct !== lastPct) {
      lastPct = pct
      pushProgress(pct, received, total)
    }
  })
  try {
    await new Promise<void>((res, rej) => {
      const host = new URL(candidate).hostname
      const scheduleSlowCheck = () => {
        slowTimer = setTimeout(() => {
          if (received < SLOW_MIN_BYTES) {
            reader.destroy()
            rej(new Error(`${host} 下载过慢(15s 内不足 1MB),已切换通道`))
          } else {
            scheduleSlowCheck()
          }
        }, SLOW_WINDOW_MS)
      }
      scheduleSlowCheck()
      pipeline(reader, out).then(res, e => { if (slowTimer) clearTimeout(slowTimer); rej(e) })
    })
  } finally {
    if (slowTimer) clearTimeout(slowTimer)
  }
  // 流结束后的兜底校验:chunked/无 content-length 时服务器提前断流也会被截获
  if (expectedSize && statSync(dest).size !== expectedSize) {
    throw new Error(`文件大小不符(期望 ${expectedSize},实际 ${statSync(dest).size}),疑似坏字节`)
  }
}

/** 下载文件完整性校验:size(若有) + latest.yml 的 sha512(若可取);任一不符即视为坏字节 */
async function verifyInstaller(dest: string, expectedSize: number | undefined, assetUrl: string): Promise<{ ok: boolean; message?: string }> {
  try {
    if (expectedSize && statSync(dest).size !== expectedSize) {
      return { ok: false, message: '文件大小不符,疑似坏字节' }
    }
    let sha512 = ''
    try {
      // latest.yml 与安装包同目录:镜像通道同样可用
      const ymlUrl = assetUrl.replace(/\/[^/]+$/, '/latest.yml')
      for (const candidate of downloadCandidates(ymlUrl)) {
        try {
          const r = await net.fetch(candidate, { headers: { 'User-Agent': 'Knowbase-App' }, redirect: 'follow' })
          if (!r.ok || !r.body || /text\/html/i.test(String(r.headers.get('content-type') || ''))) continue
          const txt = await r.text()
          const m = /sha512:\s*([A-Za-z0-9+/=]+)/.exec(txt)
          if (m) { sha512 = m[1]; break }
        } catch { /* 换下一候选 */ }
      }
    } catch { /* 取不到 latest.yml → 退回仅 size 校验 */ }
    if (sha512) {
      const expected = Buffer.from(sha512, 'base64')
      const hash = createHash('sha512')
      const buf = await new Promise<Buffer>((res, rej) => {
        const s = require('fs').createReadStream(dest)
        s.on('data', c => hash.update(c))
        s.on('end', () => res(hash.digest()))
        s.on('error', rej)
      })
      if (!buf.equals(expected)) return { ok: false, message: '文件校验和(SHA512)不符,镜像可能返回了坏字节' }
    }
    return { ok: true }
  } catch (e: any) {
    return { ok: false, message: e?.message || String(e) }
  }
}

export function registerUpdateHandlers(deps?: { getSettingValue?: (key: string) => unknown }): void {
  if (deps?.getSettingValue) getSettingValue = deps.getSettingValue
  ipcMain.handle('update:check', async (): Promise<UpdateCheckResult> => {
    const currentVersion = app.getVersion()
    try {
      const res = await net.fetch(API_LATEST, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Knowbase-App' }
      })
      if (!res.ok) throw new Error(`GitHub API 返回 ${res.status}`)
      const rel: any = await res.json()
      const latestVersion = String(rel.tag_name || '').replace(/^v/i, '')
      if (!latestVersion) throw new Error('未找到版本号')
      return {
        ok: true,
        hasUpdate: isNewer(latestVersion, currentVersion),
        currentVersion,
        latestVersion,
        releaseUrl: String(rel.html_url || RELEASES_PAGE),
        notes: String(rel.body || ''),
        asset: pickAsset(rel.assets),
      }
    } catch (e: any) {
      return { ok: false, hasUpdate: false, currentVersion, latestVersion: '', releaseUrl: RELEASES_PAGE, notes: '', asset: null, message: e?.message || String(e) }
    }
  })

let downloading = false
  ipcMain.handle('update:download', async (_e, url: string, name: string, expectedSize?: number) => {
    if (downloading) return { success: false, message: '已有下载任务进行中' }
    try {
      const parsed = new URL(url)
      if (!/^https?:$/.test(parsed.protocol) || !/github\.com$/i.test(parsed.hostname)) {
        return { success: false, message: 'URL 不受信任' }
      }
    } catch {
      return { success: false, message: 'URL 非法' }
    }
    const safeName = String(name || 'Knowbase-setup.exe').split(/[\\/]/).pop() || 'Knowbase-setup.exe'
    downloading = true
    const dir = app.getPath('downloads')
    try { if (!existsSync(dir)) mkdirSync(dir, { recursive: true }) } catch { /* ignore */ }
    const dest = join(dir, safeName)
    let lastErr = ''
    try {
      // 逐个候选通道:下载 → 完整性校验 → 通过才返回;坏字节自动换下一通道
      for (const candidate of downloadCandidates(url)) {
        try {
          await downloadOne(candidate, dest, expectedSize)
          const check = await verifyInstaller(dest, expectedSize, url)
          if (check.ok) {
            pushProgress(100, statSync(dest).size, expectedSize || statSync(dest).size)
            return { success: true, filePath: dest }
          }
          lastErr = check.message
          try { if (existsSync(dest)) unlinkSync(dest) } catch { /* ignore */ }
        } catch (e: any) {
          lastErr = e?.message || String(e)
          try { if (existsSync(dest)) unlinkSync(dest) } catch { /* ignore */ }
        }
      }
return { success: false, message: lastErr || '所有下载通道均失败' }
    } finally {
      downloading = false
    }
  })

  ipcMain.handle('update:install', (_e, filePath: string) => {
    // 仅允许运行系统"下载"目录内的安装包
    try {
      const downloads = resolve(app.getPath('downloads'))
      const resolved = resolve(filePath)
      if (!resolved.startsWith(downloads.endsWith('\\') ? downloads : downloads + '\\')) {
        return { success: false, message: '路径不受信任' }
      }
      if (!existsSync(resolved)) return { success: false, message: '安装包不存在' }
      shell.openPath(resolved)
      return { success: true }
    } catch (e: any) {
      return { success: false, message: e?.message || String(e) }
    }
  })
}
