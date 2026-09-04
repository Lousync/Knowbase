/**
 * 文档文本提取服务（builtin.docs.read-text 数据源，docs/agent-file-tools-design.md §13）
 * - .pdf → pdfjs-dist legacy（Node 主进程 + workerSrc 本机 worker，2026-09-03 实测可行）
 * - .pptx → 复用 zip.ts 解压 + 手读 ppt/slides/slide*.xml 的 <a:t>（零新依赖）
 * - 仅纯文本提取（供 LLM 通读），不做渲染/OCR；扫描件（图片型 PDF）提取为空属预期
 */

import { readFileSync, statSync } from 'fs'
import { extname } from 'path'
import { unzipBuffer } from './zip'

export interface DocTextOutput {
  kind: 'pdf' | 'pptx'
  /** 纯文本（各页间 \n 分隔；pptx 每页以空行分隔） */
  text: string
  pages: number
  totalChars: number
}

const MAX_DOC_SIZE = 80 * 1024 * 1024 // pptx/pdf 上限 80MB
const MAX_PDF_PAGES = 200

// ===== pdfjs（Node 主进程）=====

interface PdfPageLike {
  getTextContent: () => Promise<{ items: Array<{ str?: string }> }>
}
interface PdfDocLike {
  numPages: number
  getPage: (n: number) => Promise<PdfPageLike>
  destroy?: () => Promise<void>
}

let pdfjsPromise: Promise<{
  GlobalWorkerOptions: { workerSrc: string }
  getDocument: (p: { data: Uint8Array }) => { promise: Promise<PdfDocLike> }
}> | null = null

function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfjs = require('pdfjs-dist/legacy/build/pdf.js') as {
        GlobalWorkerOptions: { workerSrc: string }
        getDocument: (p: { data: Uint8Array }) => { promise: Promise<PdfDocLike> }
      }
      try {
        // Node 无 DOM Worker → 指向本机 worker 文件（v3.11 isNodeJS 分支支持，2026-09-03 实测可行）
        pdfjs.GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/legacy/build/pdf.worker.js')
      } catch { /* workerSrc 设不上时 pdfjs 会走 fake worker 失败路径，由调用方兜错 */ }
      return pdfjs
    })()
  }
  return pdfjsPromise
}

async function extractPdf(absPath: string): Promise<{ text: string; pages: number }> {
  const pdfjs = await loadPdfjs()
  const data = new Uint8Array(readFileSync(absPath))
  const doc = await pdfjs.getDocument({ data }).promise
  const pageCount = Math.min(doc.numPages, MAX_PDF_PAGES)
  const chunks: string[] = []
  for (let i = 1; i <= pageCount; i++) {
    try {
      const page = await doc.getPage(i)
      const tc = await page.getTextContent()
      chunks.push(tc.items.map(it => String(it?.str ?? '')).filter(Boolean).join(' '))
    } catch {
      chunks.push('') // 单页失败不中断（扫描页/异常页跳过）
    }
  }
  try { await doc.destroy?.() } catch { /* ignore */ }
  return { text: chunks.join('\n'), pages: doc.numPages }
}

// ===== pptx（zip + XML）=====

function decodeXml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(parseInt(d, 10)))
}

function slideNumOf(name: string): number {
  const m = name.match(/slide(\d+)\.xml/i)
  return m ? parseInt(m[1], 10) : 0
}

function extractPptxRaw(absPath: string): { n: number; text: string }[] {
  const map = unzipBuffer(readFileSync(absPath))
  const slideNames = [...map.keys()]
    .filter(k => /^ppt\/slides\/slide\d+\.xml$/i.test(k))
    .sort((a, b) => slideNumOf(a) - slideNumOf(b))
  return slideNames.map(name => {
    const xml = map.get(name)!.toString('utf-8')
    const parts: string[] = []
    for (const m of xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)) parts.push(decodeXml(m[1]))
    return { n: slideNumOf(name), text: parts.join(' ') }
  })
}

function extractPptx(absPath: string): { text: string; pages: number } {
  const pages = extractPptxRaw(absPath)
  return { text: pages.map(p => p.text).join('\n'), pages: pages.length }
}

/** 按页返回 PPT 文本（界面逐页阅读用；页号取文件内 slideN 编号） */
export function extractPptxPages(absPath: string): { n: number; text: string }[] {
  return extractPptxRaw(absPath)
}

// ===== 入口 =====

/** 按扩展名提取文档文本；不支持的类型明确拒绝（.md/.txt 走 vault.read） */
export async function extractDocText(absPath: string): Promise<DocTextOutput> {
  const st = statSync(absPath)
  if (!st.isFile()) throw new Error('不是文件')
  if (st.size > MAX_DOC_SIZE) throw new Error(`文件过大（${st.size} 字节 > 80MB）`)
  const ext = extname(absPath).slice(1).toLowerCase()
  if (ext === 'pdf') {
    const r = await extractPdf(absPath)
    return { kind: 'pdf', text: r.text, pages: r.pages, totalChars: r.text.length }
  }
  if (ext === 'pptx') {
    const r = extractPptx(absPath)
    return { kind: 'pptx', text: r.text, pages: r.pages, totalChars: r.text.length }
  }
  throw new Error('仅支持 .pdf / .pptx 文本提取（.md/.txt 请用 vault.read；Word/扫描件暂不支持）')
}
