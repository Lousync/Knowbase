// AI教学 3-21 视觉转写（手动档）源码断言：LLM 多模态通路 / 主进程转写并稿 / 渲染层栅格化与入口。
// 用法：node tmp/smoke/ai-teaching-p6-vision-source-smoke.mjs
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf-8')
const LLM = rd('electron/lib/llmService.ts')
const SRC = rd('electron/lib/aiTeachingSources.ts')
const PRE = rd('electron/preload/index.ts')
const TY = rd('src/types/index.ts')
const IPC = rd('src/lib/ipc.ts')
const MOD = rd('src/modules/ai-teaching/index.tsx')

let passed = 0, failed = 0
function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.error(`  ✗ ${name}${extra ? ' :: ' + extra : ''}`) }
}
console.log('AI教学 3-21 视觉转写源码冒烟：')

// ── LLM 层：多模态通路（应用首个图片输入能力） ──
ok('视觉能力启发式正则 + 双端探测通道（同 reasoningCapable 哲学）',
  LLM.includes('VISION_MODEL_RE = /') && LLM.includes("ipcMain.handle('llm:visionCapable'"))
ok('findVisionModel：仅启用的 openai-compatible 供应商内挑疑似视觉模型；支持 preferredSpec 覆盖',
  LLM.includes("p.type === 'openai-compatible'") && LLM.includes('function findVisionModel') && LLM.includes('if (preferredSpec)') && LLM.includes("preferredSpec.split(':')"))
ok('visionChat：OpenAI 多模态 content 数组（text + image_url 部件）直通 adapter，maxTokens 收口 1k~16k',
  LLM.includes("type: 'image_url', image_url: { url: u }") && LLM.includes('messages as unknown as ChatMessage[]') && LLM.includes('Math.min(16384'))
ok('无视觉模型时给配置指引（不静默失败）',
  LLM.includes('未找到可用的视觉模型'))

// ── 素材服务：字节通道 + 逐页转写并入提取稿 ──
ok('pdfBytes 仅登记内 pdf 原件；>80MB 拒绝',
  SRC.includes("e.type !== 'pdf'") && SRC.includes('80 * 1024 * 1024') && SRC.includes("toString('base64')"))
ok('转写系统提示词：LaTeX 公式/md 表格/【图：…】描述/严禁编造（忠实转写四原则）',
  ['LaTeX', 'Markdown 表格', '【图：', '严禁编造'].every(k => SRC.includes(k)))
ok('逐页调用：单页失败不中断其余（failed[] 汇总），全失败才整体报错',
  SRC.includes('else failed.push(p.n)') && SRC.includes('if (done.length === 0) return { ok: false, failed,'))
ok('并入提取稿非破坏：已有提取稿文末追补「## 视觉转写」节（保留文本层与用户修正）',
  SRC.includes('## 视觉转写（') && SRC.includes("old.replace(/\\s+$/, '')"))
ok('无提取稿：以转写新建标准命名提取稿并回写「已提取 ✓ → 文件」（3-26 语义维持）',
  SRC.includes('-p${rg.from}-${rg.to}.md') && SRC.includes('extracted: `✓ → ${extName}`'))
ok('单次 ≤12 页上限（双保险，渲染层先截）', SRC.includes('.slice(0, 12)'))

// ── 三层接线 ──
ok('aiTeachSrc:pdfBytes / aiTeachSrc:transcribe 通道三层齐备',
  ['aiTeachSrcPdfBytes', 'aiTeachSrcTranscribe'].every(k => PRE.includes(k) && TY.includes(k) && IPC.includes(k)) &&
  SRC.includes("ipcMain.handle('aiTeachSrc:pdfBytes'") && SRC.includes("ipcMain.handle('aiTeachSrc:transcribe'"))

// ── 渲染层：pdf.js 栅格化 + 入口 ──
ok('转写在渲染层栅格化：动态 import pdfjs-dist（worker ?url）不增大模块初始包',
  MOD.includes("await import('pdfjs-dist')") && MOD.includes("await import('pdfjs-dist/build/pdf.worker.min.js?url')"))
ok('栅格化参数：scale 2 高清 + 白底 + JPEG 0.82 压体积；12 页截断带提示',
  MOD.includes('getViewport({ scale: 2 })') && MOD.includes("toDataURL('image/jpeg', 0.82)") && MOD.includes('单次转写上限 12 页'))
ok('区间跟随登记（12-34 起=12）；未登记区间 = 前 12 页；页数 clamp 到 numPages',
  /parseInt\(m\[1\], 10\)/.test(MOD) && MOD.includes('Math.min(doc.numPages, 12)') && MOD.includes('Math.min(doc.numPages, Math.max(from, to))'))
ok('条目卡「转写」按钮（pdf 且有路径）：visionBusy 进度文案 + 完成即开提取稿阅读',
  MOD.includes('doTranscribe(e.no)') && MOD.includes("e.type === 'pdf' && e.path && e.path !== '-'") && MOD.includes('visionBusy.label') && MOD.includes('openDocView(r.relPath)'))

console.log(`\n结果: ${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
