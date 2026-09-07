// AI教学 P6（素材库 SOURCE.md 登记/区间提取/AI 引用注入，§3.13 结构 v3）源码断言。
// 用法：node tmp/smoke/ai-teaching-p6-source-smoke.mjs
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf-8')
const SRC = rd('electron/lib/aiTeachingSources.ts')
const FLD = rd('electron/lib/aiTeachingFolders.ts')
const SVC = rd('electron/lib/agentService.ts')
const DOCS = rd('electron/lib/docsReader.ts')
const MAIN = rd('electron/main/index.ts')
const PRE = rd('electron/preload/index.ts')
const TY = rd('src/types/index.ts')
const IPC = rd('src/lib/ipc.ts')
const MOD = rd('src/modules/ai-teaching/index.tsx')

let passed = 0, failed = 0
function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.error(`  ✗ ${name}${extra ? ' :: ' + extra : ''}`) }
}
console.log('AI教学 P6 素材库源码冒烟：')

ok('结构 v3 布局：素材夹=会话父目录/SOURCES/{与会话夹同名}，登记文档 SOURCE.md（§3.13 权威结构）',
  SRC.includes("SOURCES_DIR = 'SOURCES'") && SRC.includes("SOURCE_FILE = 'SOURCE.md'") && SRC.includes('`${parentRel}/${SOURCES_DIR}/${convName}`'))
ok('SOURCE.md 模板 v2：YAML frontmatter + ### 编号小节 + 固定字段行（3-28），类型枚举 7 项（3-27 六项 + UI 优化条目10 增 code）',
  SRC.includes('workspace: ') && SRC.includes('parseSourceMd') && SRC.includes("'url', 'pptx', 'pdf', 'image', 'md', 'code', 'other'") && SRC.includes('- 页码区间: '))
ok('解析宽容 + 重写保留 frontmatter 并刷新 updated（三入口收敛同一解析）',
  SRC.includes('rewriteEntries') && SRC.includes('updated:') && SRC.includes('sort((a, b) => a.no - b.no)'))
ok('首次读取懒生成空模板（§3.13 创建对话时生成的懒实现）',
  SRC.includes('emptyTemplate(l)') && SRC.includes("ipcMain.handle('aiTeachSrc:read'"))
ok('已入库=拷贝原件进素材夹（uniqueFileName 防撞、路径改 ./文件名）；仅引用=原样登记（3-22）',
  SRC.includes('copyFileSync(srcAbs') && SRC.includes('uniqueFileName(l.dirAbs') && SRC.includes("path = `./${copied}`"))
ok('区间提取：pdf 走 extractPdfRange / pptx 走 extractPptxPages 按页过滤（3-20 区间语义）',
  SRC.includes('extractPdfRange(abs, rg.from, rg.to)') && SRC.includes('p.n >= rg.from && p.n <= rg.to'))
ok('提取稿命名 {素材名}-p{起}-{终}.md 与 SOURCE.md 同级 + 可编辑提示 + 回写「已提取」（3-26/3-30）',
  SRC.includes('-p${rg.from}-${rg.to}.md') && SRC.includes('可直接编辑修正') && SRC.includes('✓ → ${extractName}'))
ok('程序防重复提取：已 ✓ 条目短路返回现有提取稿（3-26）',
  SRC.includes('if (ext) return { ok: true, relPath:'))
ok('AI 注入：resolveSourcesForInjection 每轮重读 + 提取稿优先指引 + [1] p.15 编号引用 + 末尾引用清单（3-25/3-29）',
  SRC.includes('resolveSourcesForInjection') && SRC.includes('优先读此文件') && SRC.includes('[1] p.15') && SRC.includes('本次引用素材') &&
  SVC.includes('resolveSourcesForInjection(sessionId, getSettingReader())') && SVC.includes('askRuleHint + sourcesHint'))
ok('无登记=零注入（存量会话无扰）+ 3500 截断防 token 失控',
  SRC.includes('if (entries.length === 0) return \'\'') && SRC.includes('3500'))
ok('对话改名→素材夹同步重命名；删除会话 delete 模式素材夹同进回收站（3-31 跟随同设置）',
  FLD.includes("join(parentAbs, 'SOURCES', oldName)") && FLD.includes('/SOURCES/${rel.slice(lastSlash + 1)}') && FLD.includes('3-31'))
ok('docsReader 页区间提取导出（extractPdfRange，全量行为零回归）',
  DOCS.includes('export async function extractPdfRange') && DOCS.includes('extractPdfPages'))
ok('IPC 注册 + 三层接线（read/add/remove/extract/pick 5 通道）',
  MAIN.includes('registerAiTeachingSourceHandlers') &&
  ['aiTeachSrcRead', 'aiTeachSrcAdd', 'aiTeachSrcRemove', 'aiTeachSrcExtract', 'aiTeachSrcPick'].every(k => PRE.includes(k) && TY.includes(k) && IPC.includes(k)))
ok('入库浏览=系统文件选择器（aiTeachSrc:pick 绝对路径回传）',
  SRC.includes('dialog.showOpenDialog') && SRC.includes("extensions: ['pdf', 'pptx'"))

ok('右栏素材库区：条目卡（#编号/名称/类型/区间/存放）+ SOURCE 阅读 + ＋素材按钮',
  MOD.includes('素材库{srcEntries.length') && MOD.includes('void openDocView(srcFileRel)') && MOD.includes('setSrcForm({ name: \'\', type: \'pdf\''))
ok('添加素材表单：类型下拉/名称必填/存放双模式/区间仅 pdf·pptx·code 拆起止双输入（§3.13 拍板 + 条目10 code 行号）',
  MOD.includes("srcForm.type === 'pdf' || srcForm.type === 'pptx' || srcForm.type === 'code'") &&
  MOD.includes("srcForm.type === 'code' ? '起始行' : '起始页'") && MOD.includes("srcForm.type === 'code' ? '结束行' : '结束页'") && MOD.includes('浏览…'))
ok('条目5.2（真机 A1）：表单挂根层（工作区视图可达）+ 未选对话时按钮给引导 toast',
  MOD.indexOf('{srcForm && (') > MOD.indexOf('工作区选择页') &&
  MOD.includes('条目5.2.1') && MOD.includes('先选择或新建一个对话（素材随对话登记）'))
ok('登记成功 toast「✓ 已写入 SOURCE.md」+ 列表即时同步（refreshSources 回读）',
  MOD.includes('✓ 已写入 SOURCE.md') && MOD.includes('await refreshSources(activeId)'))
ok('条目动作：提取（pdf/pptx 未提取）/提取稿阅读跳转/原件逐页阅读/移除登记（不删文件）',
  MOD.includes('doExtract(e.no)') && MOD.includes('提取稿 ✓') && MOD.includes('doRemoveSrc(e.no, e.name)') && MOD.includes('素材原件与提取稿文件不会被删除'))
ok('切会话自动回读素材登记（activeId effect）',
  MOD.includes('useEffect(() => { void refreshSources(activeId) }, [activeId, refreshSources])'))

// ---------- UI 优化条目5.3 / 条目10 追加断言 ----------
ok('条目5.3 解析容错加强：编号小节标题容忍 1~6 级与 # 后无空格、字段行容忍漏写前导 - 与冒号、值去反引号',
  SRC.includes('/^#{1,6}\\s*(\\d+)\\s*[.、]\\s*(.+?)\\s*$/') && SRC.includes('/^[-*]?\\s*(类型|路径|页码区间|行号区间|区间|存放方式|已提取|备注)(?:\\s*[：:]\\s*|\\s+)(.*)$/') &&
  SRC.includes('const clean = (v: string)'))
ok('条目5.3 异常统计：缺编号小节 / 编号重复被丢弃 → 右栏可见提示（不静默丢失）',
  SRC.includes('export function sourceAnomalies') && SRC.includes('anomalies') &&
  MOD.includes('个小节缺「编号.」未登记') && MOD.includes('处编号重复被忽略'))
ok('条目10 code 类型：文本源码按行号区间抽取（readTextSmart 编码兜底、超 2000 行截断、提取稿 {名}-L{起}-{终}.md）+ 区间容忍 L/行 前缀',
  SRC.includes("if (e.type === 'code')") && SRC.includes('const raw = readTextSmart(abs)') &&
  SRC.includes('-L${from}-${takeEnd}.md') && SRC.includes('const capped = to - from > 2000') &&
  SRC.includes("(?:[Ll]|行)?") && SRC.includes('TextDecoder'))
ok('条目10 类型枚举三处同步（服务枚举/表单下拉/模板说明）+ 注入按页/行区间措辞分流',
  MOD.includes("'code'") && SRC.includes('code 行号') && SRC.includes('code（按行号区间）') &&
  SRC.includes("e.type === 'code' ? '行号区间' : '页码区间'"))
ok('条目10/5.3 真机补口：手编 SOURCE.md 用「行号区间」（或裸「区间」）＝「页码区间」别名，落盘仍统一写页码区间',
  SRC.includes('页码区间|行号区间|区间') && SRC.includes("m[1] === '页码区间' || m[1] === '行号区间' || m[1] === '区间'") &&
  SRC.includes('`- 页码区间: ${e.range'))

console.log(`\n结果: ${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
