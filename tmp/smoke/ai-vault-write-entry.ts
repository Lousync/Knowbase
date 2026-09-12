// AI vault 写工具 × 索引失效闭环冒烟：写 .md → 缓存删 → 图谱/列表即时可见（本次修复的行为证明）
import { registerAiToolHandlers, invokeToolInternal } from '../../electron/lib/aiTools'
import { initDatabase } from '../../electron/database/connection'
import { registerBuiltinTools } from '../../electron/lib/builtinTools'
import { setCurrentVault } from '../../electron/lib/kbStore/vaultContext'
import { getKnowledgeIndex } from '../../electron/lib/kbStore/knowledgeIndex'
import { getGraphIndex } from '../../electron/lib/kbStore/graphIndex'
import * as fs from 'fs'
import * as path from 'path'

const VAULT = 'C:\\Users\\<用户名>\\Documents\\我的仓库'
const KB = path.join(VAULT, '.knowbase')
const MD = path.join(VAULT, 'AI索引失效测试.md')
const REL = 'AI索引失效测试.md'

const settings: Record<string, unknown> = { storageKnowledge: 'vault', storageBlog: 'vault', storageData: 'vault', aiVaultFilePerm: 'write' }
registerAiToolHandlers({ getSettingValue: (k) => settings[k] })
registerBuiltinTools()

setCurrentVault({ rootId: '17bfb19f-be5e-43ad-84cd-4dea03daff18', name: '我的仓库', rootPath: VAULT })

let pass = 0, fail = 0
const ok = (c: unknown, n: string) => { if (c) { pass++; console.log('  ✓ ' + n) } else { fail++; console.log('  ✗ ' + n) } }

void (async () => {
  await initDatabase()
  // 基线：先删缓存强制按磁盘真实状态重建（防上轮运行的陈旧缓存污染基线）
  try {
    fs.unlinkSync(path.join(KB, 'cache', 'knowledge-index.json'))
    fs.unlinkSync(path.join(KB, 'cache', 'graph.json'))
  } catch { /* ignore */ }
  const idx0 = getKnowledgeIndex()
  const g0 = getGraphIndex()
  console.log(`基线: 知识页=${idx0.pages.length} 图谱节点=${g0.nodes.length} 边=${g0.edges.length}`)
  ok(fs.existsSync(path.join(KB, 'cache', 'knowledge-index.json')), '缓存文件预先存在')

  // ① AI 经权限链路写 .md —— 按「知识页」契约带 frontmatter.id（无 id 的 .md 是合法普通文件，不入知识索引）
  const PAGE_ID = 'aa-bb-cc-dd-ee-ff-99-01'
  const w = await invokeToolInternal('builtin.vault.write', { path: REL, content: `---\nid: ${PAGE_ID}\ntitle: AI 索引失效测试\nstatus: draft\n---\n\n# AI 索引失效测试\n\n关联 [[新建文件]]\n` })
  ok(w.ok === true, `vault.write 经权限链成功 (${w.ok ? '' : JSON.stringify(w).slice(0, 120)})`)
  ok(!fs.existsSync(path.join(KB, 'cache', 'knowledge-index.json')) && !fs.existsSync(path.join(KB, 'cache', 'graph.json')), '写后 knowledge-index/graph 缓存已被失效删除（本次修复点）')

  // ② 懒重建立即反映 AI 写入
  const idx1 = getKnowledgeIndex()
  const g1 = getGraphIndex()
  const hasPage = idx1.pages.some((p) => p.title === 'AI 索引失效测试')
  const hasEdge = g1.edges.length > g0.edges.length
  console.log(`重建: 知识页=${idx1.pages.length} 图谱节点=${g1.nodes.length} 边=${g1.edges.length}`)
  ok(hasPage, '知识列表即时出现 AI 新建页')
  ok(hasEdge, `图谱即时长出 [[双链]] 边（${g0.edges.length}→${g1.edges.length}）`)

  // ③ vault.edit 同样失效 + 重建
  const e = await invokeToolInternal('builtin.vault.edit', { path: REL, oldText: '关联 [[新建文件]]', newText: '已解除关联', expectedMtimeMs: (w.data as { mtimeMs: number })?.mtimeMs })
  ok(e.ok === true, 'vault.edit 成功')
  ok(!fs.existsSync(path.join(KB, 'cache', 'knowledge-index.json')), 'edit 后知识索引缓存同样失效')
  const g2 = getGraphIndex()
  ok(getKnowledgeIndex().pages.find((p) => p.title === 'AI 索引失效测试')?.outgoingTitles?.length === 0, 'edit 后该页出链清零（索引内容为新文本）')
  console.log(`edit 重建: 图谱节点=${g2.nodes.length} 边=${g2.edges.length}`)

  // ④ 权限负例：read 档拒绝写入
  settings.aiVaultFilePerm = 'read'
  const denied = await invokeToolInternal('builtin.vault.write', { path: REL, content: 'x' })
  ok(!denied.ok && (denied as { code?: string }).code === 'VAULTFILE_READONLY', `read 档拒写 (${(denied as { code?: string; message?: string }).code})`)
  // ⑤ 权限负例：.knowbase 保护区拒写
  settings.aiVaultFilePerm = 'write'
  const prot = await invokeToolInternal('builtin.vault.write', { path: '.knowbase/cache/evil.json', content: 'x' })
  ok(!prot.ok, `保护区路径拒写 (${(prot as { message?: string }).message?.slice(0, 40)})`)
  // ⑥ 越界拒写
  const esc = await invokeToolInternal('builtin.vault.write', { path: '../escape.txt', content: 'x' })
  ok(!esc.ok, `越界路径拒写 (${(esc as { message?: string }).message?.slice(0, 40)})`)

  // 清理：删测试 md + 手动失效缓存（模拟产品路径 ws:trash 的 invalidate——冒烟直删不走该路径）
  try { fs.unlinkSync(MD) } catch { /* ignore */ }
  try {
    fs.unlinkSync(path.join(KB, 'cache', 'knowledge-index.json'))
    fs.unlinkSync(path.join(KB, 'cache', 'graph.json'))
  } catch { /* ignore */ }
  const g3 = getGraphIndex()
  ok(!getKnowledgeIndex().pages.some((p) => p.title === 'AI 索引失效测试'), '清理后 A 仓知识恢复原状')
  console.log(`收尾: 知识页=${getKnowledgeIndex().pages.length} 图谱节点=${g3.nodes.length} 边=${g3.edges.length}（应为基线 ${idx0.pages.length}/${g0.nodes.length}/${g0.edges.length}）`)

  console.log(`\n${pass} pass / ${fail} fail`)
  process.exit(fail > 0 ? 1 : 0)
})()
