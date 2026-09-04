// PDF 主进程文本提取可行性探测（docs.read-text 前置）：pdf-lib 造样张 → pdfjs legacy 提取
import { writeFileSync } from 'fs'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)

const out = 'tmp/probe-docs-reader.pdf'
const doc = await PDFDocument.create()
const font = await doc.embedFont(StandardFonts.Helvetica)
let page = doc.addPage([300, 200])
page.drawText('Hello Knowbase Docs Reader probe 123', { x: 30, y: 120, size: 14, font })
page = doc.addPage([300, 200])
page.drawText('Second page line here', { x: 30, y: 120, size: 14, font })
writeFileSync(out, await doc.save())
console.log('sample written:', out)

const pdfjs = require('pdfjs-dist/legacy/build/pdf.js')
// 尝试 A：只设 workerSrc 为本地 worker 文件路径
try {
  pdfjs.GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/legacy/build/pdf.worker.js')
  const data = new Uint8Array(require('fs').readFileSync(out))
  const d = await pdfjs.getDocument({ data }).promise
  console.log('pages:', d.numPages)
  let text = ''
  for (let i = 1; i <= d.numPages; i++) {
    const pg = await d.getPage(i)
    const tc = await pg.getTextContent()
    text += tc.items.map((it) => it.str).join(' ') + '\n'
  }
  console.log('EXTRACT OK:', JSON.stringify(text))
} catch (e) {
  console.log('A workerSrc failed:', String(e && e.message || e).slice(0, 300))
  // 尝试 B：主线程 workerPort=null 显式关 worker?（v3 无 disableWorker，尝试 workerPort null 无意义）
  try {
    pdfjs.GlobalWorkerOptions.workerSrc = ''
    const data = new Uint8Array(require('fs').readFileSync(out))
    const d = await pdfjs.getDocument({ data }).promise
    console.log('B pages:', d.numPages)
  } catch (e2) {
    console.log('B failed:', String(e2 && e2.message || e2).slice(0, 300))
  }
}

// 用途：长期回归钩子 —— pdfjs legacy 在 Node 主进程的文本提取可行性（docs.read-text 依赖）
