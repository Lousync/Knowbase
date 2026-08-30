import { ipcMain, dialog, BrowserWindow } from 'electron'
import { writeFileSync } from 'fs'
import { PDFDocument, degrees } from 'pdf-lib'

/**
 * PDF 工具箱（主进程侧）：结构化操作走 pdf-lib（合并/页面重组），纯 JS 零原生依赖。
 * 文本提取/缩略图在渲染层用 pdf.js 完成（浏览器构建更稳），本服务只收发字节。
 * 导出统一走系统存盘对话框，取消返回 null。
 */

interface PdfMergeItem { name: string; data: Uint8Array }

export function registerPdfHandlers(): void {
  // 合并多个 PDF（按传入顺序）
  ipcMain.handle('pdf:merge', async (_e, files: PdfMergeItem[]) => {
    try {
      if (!Array.isArray(files) || files.length < 2) return { ok: false, error: '至少需要两个 PDF 文件' }
      const out = await PDFDocument.create()
      for (const f of files) {
        if (!f?.data) return { ok: false, error: `文件内容缺失: ${f?.name ?? '?'}` }
        const src = await PDFDocument.load(f.data, { ignoreEncryption: true })
        const copied = await out.copyPages(src, src.getPageIndices())
        copied.forEach(pg => out.addPage(pg))
      }
      const bytes = await out.save()
      return { ok: true, data: new Uint8Array(bytes) }
    } catch (err) {
      return { ok: false, error: String((err as Error)?.message ?? err).slice(0, 300) }
    }
  })

  // 页面重组：pages 为 0 基原始页码的目标顺序，rotations 为页码 → 累计旋转角度（90 的倍数）
  ipcMain.handle('pdf:organize', async (_e, payload: { data: Uint8Array; pages: number[]; rotations?: Record<string, number> }) => {
    try {
      const { data, pages, rotations } = payload ?? {}
      if (!data || !Array.isArray(pages) || pages.length === 0) return { ok: false, error: '参数缺失' }
      const src = await PDFDocument.load(data, { ignoreEncryption: true })
      const total = src.getPageCount()
      if (pages.some(p => !Number.isInteger(p) || p < 0 || p >= total)) return { ok: false, error: '页码越界' }
      const out = await PDFDocument.create()
      const copied = await out.copyPages(src, pages)
      copied.forEach((pg, i) => {
        const rot = rotations?.[String(pages[i])] ?? 0
        if (rot) pg.setRotation(degrees((pg.getRotation().angle + rot + 360) % 360))
        out.addPage(pg)
      })
      const bytes = await out.save()
      return { ok: true, data: new Uint8Array(bytes) }
    } catch (err) {
      return { ok: false, error: String((err as Error)?.message ?? err).slice(0, 300) }
    }
  })

  // 导出：系统存盘对话框 + 写盘；用户取消返回 { ok: false, cancelled: true }
  ipcMain.handle('pdf:export', async (_e, payload: { data: Uint8Array; defaultName: string; kind?: 'pdf' | 'txt' }) => {
    try {
      const { data, defaultName, kind = 'pdf' } = payload ?? {}
      if (!data) return { ok: false, error: '内容为空' }
      const win = BrowserWindow.getFocusedWindow() ?? undefined
      const filters = kind === 'txt'
        ? [{ name: '文本文件', extensions: ['txt'] }]
        : [{ name: 'PDF 文件', extensions: ['pdf'] }]
      const r = await dialog.showSaveDialog(win as BrowserWindow, {
        title: '导出',
        filters,
        defaultPath: String(defaultName ?? (kind === 'txt' ? '提取文本.txt' : 'merged.pdf')),
      })
      if (r.canceled || !r.filePath) return { ok: false, cancelled: true }
      writeFileSync(r.filePath, Buffer.from(data))
      return { ok: true, path: r.filePath }
    } catch (err) {
      return { ok: false, error: String((err as Error)?.message ?? err).slice(0, 300) }
    }
  })
}
