// AI 双链全生命周期冒烟（阶段①）：建页→挂链(标题/别名/锚点/悬空)→正反链端点→编辑断链
import { registerAiToolHandlers, invokeToolInternal } from '../../electron/lib/aiTools'
import { initDatabase } from '../../electron/database/connection'
import { registerBuiltinTools } from '../../electron/lib/builtinTools'
import { setCurrentVault } from '../../electron/lib/kbStore/vaultContext'
import { getKnowledgeIndex } from '../../electron/lib/kbStore/knowledgeIndex'
import { getGraphIndex } from '../../electron/lib/kbStore/graphIndex'
import { vaultGetBacklinks, vaultGetBacklinkContext } from '../../electron/lib/kbStore/knowledgeVaultRepo'
import * as fs from 'fs'
import * as path from 'path'

const VAULT = 'C:\\Users\\<用户名>\\Documents\\我的仓库'
const KB = path.join(VAULT, '.knowbase')
const settings: Record<string, unknown> = { storageKnowledge: 'vault', storageBlog: 'vault', storageData: 'vault', aiVaultFilePerm: 'write' }
registerAiToolHandlers({ getSettingValue: (k) => settings[k] })
registerBuiltinTools()
setCurrentVault({ rootId: '17bfb19f-be5e-43ad-84cd-4dea03daff18', name: '我的仓库', rootPath: VAULT })

let pass = 0, fail = 0
const ok = (c: unknown, n: string) => { if (c) { pass++; console.log('  ✓ ' + n) } else { fail++; console.log('  ✗ ' + n) } }

const dropCaches = () => { for (const f of ['knowledge-index.json', 'graph.json']) { try { fs.unlinkSync(path.join(KB, 'cache', f)) } catch { /* ignore */ } } }
// e1 失败时退到磁盘现值（内容未变，e2 的 oldText 仍在）
const e2mtimeSafe = (e1: { ok?: boolean; data?: unknown }) =>
  e1.ok ? (e1.data as { mtimeMs: number }).mtimeMs : fs.statSync(path.join(VAULT, 'AI双链测试乙.md')).mtimeMs

void (async () => {
  await initDatabase()
  dropCaches()

  console.log('== 1. AI 建两页（甲=被链方；乙=挂链方，标题/别名/锚点/文件名/悬空 五式全上）==')
  const P1 = 'AI双链测试甲.md', P2 = 'AI双链测试乙.md'
  const w1 = await invokeToolInternal('builtin.vault.write', { path: P1, content: '---\nid: probe-aa01-0000-0000-000000000001\ntitle: AI双链测试甲\nstatus: published\n---\n\n# AI双链测试甲\n\n本页将被乙页引用。\n' })
  const w2 = await invokeToolInternal('builtin.vault.write', { path: P2, content: '---\nid: probe-aa01-0000-0000-000000000002\ntitle: AI双链测试乙\nstatus: published\n---\n\n# AI双链测试乙\n\n按标题链 [[AI双链测试甲]]，带别名链 [[AI双链测试甲|甲同学]]，锚点链 [[AI双链测试甲#某小节]]，按文件名链 [[新建文件]]，悬空链 [[不存在的页面X]]。\n' })
  ok(w1.ok === true && w2.ok === true, '两页均经权限链写入成功')

  const idx = getKnowledgeIndex()
  const g = getGraphIndex()
  const a = idx.byId['probe-aa01-0000-0000-000000000001']
  const b = idx.byId['probe-aa01-0000-0000-000000000002']
  ok(!!a && !!b, '索引收录双页')
  const newFileId = idx.pages.find((p) => p.title === '新建文件')?.id
  const edgesOf = (s: string) => g.edges.filter((e) => e.s === s || e.t === s).length
  console.log(`  图谱: 节点=${g.nodes.length} 边=${g.edges.length}（乙相关边=${b ? edgesOf(b.id) : '-'}）`)
  ok(b && edgesOf(b.id) === 2, '乙→甲、乙→新建文件 两条实边（三式指甲合并去重）')
  ok(g.unresolved.some((u) => u.name === '不存在的页面X' && b && u.refs.includes(b.id)), '悬空链接进 unresolved（不造假边）')
  ok(!g.unresolved.some((u) => /\|/.test(u.name)), '别名 | 已剥离')

  console.log('== 2. 反链端点（产品 UI 数据源）==')
  const bl = a ? vaultGetBacklinks(a.id) : []
  ok(bl.some((p) => p.title === 'AI双链测试乙'), `甲的反链含乙（${bl.length} 条）`)
  const bc = a ? vaultGetBacklinkContext(a.id) : []
  ok(bc.some((x) => /双链测试甲|甲同学/.test(x.excerpt)), `反链上下文摘录定位到引用处（${bc.length} 条）`)
  if (bc.length) console.log('  摘录样本:', JSON.stringify(bc.map((x) => x.excerpt.slice(0, 36))))

  console.log('== 3. AI 用 resolve-ref 预检（写链前校验，产品场景 A）==')
  const r = await invokeToolInternal('builtin.vault.resolve-ref', { ref: '[[AI双链测试甲]]' })
  ok(r.ok === true && (r.data as { exact?: boolean })?.exact === true, `resolve-ref 命中「AI双链测试甲」`)

  console.log('== 4. AI 编辑删除悬空链 → unresolved 即消 ==')
  const e1 = await invokeToolInternal('builtin.vault.edit', { path: P2, oldText: '，悬空链 [[不存在的页面X]]', newText: '', expectedMtimeMs: (w2.data as { mtimeMs: number }).mtimeMs })
  ok(e1.ok === true, 'vault.edit 成功' + (e1.ok ? '' : ` [${(e1 as { message?: string; code?: string }).code}] ${(e1 as { message?: string }).message?.slice(0, 120)}`))
  const g2 = getGraphIndex()
  ok(!g2.unresolved.some((u) => u.name === '不存在的页面X'), '悬空引用随编辑消失')
  ok(g2.edges.length === g.edges.length, '实边不受影响（' + g2.edges.length + '）')

  console.log('== 5. AI 断链（乙删除对甲的锚点引用之外的全部？ 否——只删对甲的标题链一次测试合并边保持） ==')
  const e2 = await invokeToolInternal('builtin.vault.edit', { path: P2, oldText: '按标题链 [[AI双链测试甲]]，', newText: '', expectedMtimeMs: (e2mtimeSafe(e1)) })
  ok(e2.ok === true, '再次编辑成功' + (e2.ok ? '' : ` [${(e2 as { message?: string }).message?.slice(0, 120)}]`))
  const g3 = getGraphIndex()
  ok(b && edgesOf(b.id) === 2, `三式仍指甲 → 边保持（${g3.edges.length} 条边）`)

  const st = fs.statSync(path.join(VAULT, P2)).size
  console.log(`\n（保留两页文件供真机阶段②：甲 ${fs.statSync(path.join(VAULT, P1)).size}B 乙 ${st}B，缓存已删除待真机懒重建）`)
  console.log(`\n${pass} pass / ${fail} fail`)
  process.exit(fail > 0 ? 1 : 0)
})()
