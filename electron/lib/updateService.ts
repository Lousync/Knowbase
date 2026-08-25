import { app, ipcMain, shell, BrowserWindow, net } from 'electron'
import { createWriteStream, existsSync, mkdirSync, unlinkSync } from 'fs'
import { join, resolve } from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'

/**
 * 应用更新检查/下载 —— 基于 GitHub Releases。
 * 检查:releases/latest API 对比本地 app.getVersion();
 * 下载:主进程流式下载安装包到系统"下载"目录,进度实时推送渲染层;
 * 安装:运行下载好的安装包(用户点完安装向导后重开应用即完成更新)。
 */

const REPO = 'Lousync/Knowbase'
const API_LATEST = `https://api.github.com/repos/${REPO}/releases/latest`
const RELEASES_PAGE = `https://github.com/${REPO}/releases`

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

export function registerUpdateHandlers(): void {
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
  ipcMain.handle('update:download', async (_e, url: string, name: string) => {
    if (downloading) return { success: false, message: '已有下载任务进行中' }
    // 下载地址仅信任 GitHub Releases 域,防渲染层被注入后借道下载任意文件
    let u: URL
    try { u = new URL(url) } catch { return { success: false, message: '下载地址无效' } }
    const trusted = u.protocol === 'https:' &&
      (u.hostname === 'github.com' || u.hostname.endsWith('.github.com') || u.hostname === 'objects.githubusercontent.com')
    if (!trusted) return { success: false, message: '下载地址不受信任' }
    // 文件名清洗:只取 basename,拒绝路径分隔符
    const safeName = String(name || 'Knowbase-setup.exe').split(/[\\/]/).pop() || 'Knowbase-setup.exe'

    downloading = true
    const dir = app.getPath('downloads')
    try { mkdirSync(dir, { recursive: true }) } catch { /* ignore */ }
    const dest = join(dir, safeName)
    try {
      const res = await net.fetch(url, { headers: { 'User-Agent': 'Knowbase-App' } })
      if (!res.ok || !res.body) throw new Error(`下载失败(HTTP ${res.status})`)
      const total = Number(res.headers.get('content-length') || 0)
      const out = createWriteStream(dest)
      let received = 0
      let lastPct = -1
      const reader = Readable.fromWeb(res.body as import('stream/web').ReadableStream)
      reader.on('data', (chunk: Buffer) => {
        received += chunk.length
        const pct = total > 0 ? Math.round((received / total) * 100) : 0
        if (pct !== lastPct) {
          lastPct = pct
          pushProgress(pct, received, total)
        }
      })
      await pipeline(reader, out)
      pushProgress(100, received, total)
      return { success: true, filePath: dest }
    } catch (e: any) {
      try { if (existsSync(dest)) unlinkSync(dest) } catch { /* ignore */ }
      return { success: false, message: e?.message || String(e) }
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
