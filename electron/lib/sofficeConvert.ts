/**
 * LibreOffice (soffice) 无头转换 —— pptx → pdf，为 AI教学素材视觉转写补上 pptx 栅格化前置
 * （docsReader 文本层拿不到的 MathType 图公式/版式，交给既有 3-21 视觉转写管线；2026-09-09 A+B 方案 B 侧）。
 *
 * 定位顺序：设置项 sofficePath → 常见安装目录 → PATH(where soffice)。找不到时返回 null，
 * 由调用方给出「安装 LibreOffice 或改用文本提取」的降级提示（pdf 路径完全不受影响）。
 * 结果按 文件名+mtime+size 键缓存于系统临时目录：同一 pptx 重复转写/分批续转只做一次转换。
 */
import { spawn, execSync } from 'child_process'
import { existsSync, mkdirSync, copyFileSync, statSync } from 'fs'
import { join, basename, extname } from 'path'
import { tmpdir } from 'os'

const CANDIDATES = [
  'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
  'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
  join(process.env.LOCALAPPDATA ?? '', 'Programs', 'LibreOffice', 'program', 'soffice.exe'),
  '/Applications/LibreOffice.app/Contents/MacOS/soffice',
  '/usr/bin/soffice',
]

let cachedExe: string | null | undefined

/** 探测 soffice 可执行文件；env/SOFFICE_PATH 便于测试注入 */
export function findSoffice(settingPath?: unknown): string | null {
  if (cachedExe !== undefined && !settingPath) return cachedExe
  const pick = (p?: unknown): string | null => {
    if (typeof p === 'string' && p.trim() && existsSync(p.trim())) return p.trim()
    return null
  }
  let exe = pick(settingPath) ?? pick(process.env.SOFFICE_PATH)
  if (!exe) exe = CANDIDATES.find(p => p && existsSync(p)) ?? null
  if (!exe) exe = probeWhere()
  if (!settingPath) cachedExe = exe
  return exe
}

function probeWhere(): string | null {
  try {
    // execSync 场景小（一次 where），同步可接受；spawn 异步版留给转换
    const { execSync } = require('child_process') as typeof import('child_process')
    const out = execSync(process.platform === 'win32' ? 'where soffice' : 'which soffice', { timeout: 5000, windowsHide: true }).toString()
    const p = out.split(/\r?\n/)[0]?.trim()
    return p && existsSync(p) ? p : null
  } catch {
    return null
  }
}

function cacheKey(absPath: string): string {
  const st = statSync(absPath)
  return `${basename(absPath, extname(absPath))}-${st.mtimeMs.toFixed(0)}-${st.size}`
}

/** pptx → pdf（无头转换）。成功返回转换后 PDF 绝对路径；失败/超时/无 soffice 返回 error。 */
export function convertToPdf(absPath: string, settingSofficePath?: unknown): Promise<{ ok: boolean; pdfPath?: string; error?: string }> {
  const exe = findSoffice(settingSofficePath)
  if (!exe) return Promise.resolve({ ok: false, error: '未找到 LibreOffice（soffice）：安装后即可对 pptx 视觉转写；或改用文本提取（公式已支持 Symbol 还原）' })
  const dir = join(tmpdir(), 'knowbase-soffice')
  try { if (!existsSync(dir)) mkdirSync(dir, { recursive: true }) } catch { /* tmp 不可写走 error */ }
  const outPdf = join(dir, `${cacheKey(absPath)}.pdf`)
  if (existsSync(outPdf) && statSync(outPdf).size > 0) return Promise.resolve({ ok: true, pdfPath: outPdf })
  const profileDir = join(dir, 'lo-profile') // 独立 UserInstallation：避免与正在运行的 Office 实例互锁
  return new Promise(resolve => {
    const child = spawn(exe, [
      '--headless', '--norestore', '--convert-to', 'pdf',
      `-env:UserInstallation=${('file:///' + profileDir.replace(/\\/g, '/'))}`,
      '--outdir', dir, absPath,
    ], { windowsHide: true })
    let settled = false
    const finish = (r: { ok: boolean; pdfPath?: string; error?: string }) => { if (!settled) { settled = true; try { child.kill() } catch { /* gone */ } resolve(r) } }
    const timer = setTimeout(() => finish({ ok: false, error: 'LibreOffice 转换超时（>120s），文件可能损坏或被占用' }), 120_000)
    child.on('error', err => { clearTimeout(timer); finish({ ok: false, error: `无法启动 soffice：${err.message}` }) })
    child.on('close', () => {
      clearTimeout(timer)
      // soffice 产物名 = 源文件名；改名进缓存键路径（含同名多版本区分）
      const native = join(dir, `${basename(absPath, extname(absPath))}.pdf`)
      if (existsSync(native)) {
        try {
          if (native !== outPdf) copyFileSync(native, outPdf)
          finish({ ok: true, pdfPath: outPdf })
        } catch (e) { finish({ ok: false, error: `转换产物落盘失败：${(e as Error).message}` }) }
      } else {
        finish({ ok: false, error: 'LibreOffice 转换未产出 PDF（检查文件是否损坏/加密）' })
      }
    })
  })
}
