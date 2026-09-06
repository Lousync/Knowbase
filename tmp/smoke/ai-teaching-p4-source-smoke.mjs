// AI教学 P4（左栏 VS Code 多分区 + 中栏文档阅读视图方案 B）源码断言。
// 用法：node tmp/smoke/ai-teaching-p4-source-smoke.mjs
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf-8')
const FT = rd('src/modules/ai-teaching/AiTeachFileTree.tsx')
const MOD = rd('src/modules/ai-teaching/index.tsx')

let passed = 0, failed = 0
function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.error(`  ✗ ${name}${extra ? ' :: ' + extra : ''}`) }
}
console.log('AI教学 P4 源码冒烟：')

ok('资源管理器复用编辑器 FileTree 纯展示组件（跨模块零复制）',
  FT.includes("from '../editor/components/FileTree'") && FT.includes("from '../editor/types'"))
ok('树根 = aiTeachRootDir 设置（产物根），IPC 调用统一拼 `${rootDir}/${rel}` 前缀',
  FT.includes("getSettingRaw('aiTeachRootDir')") && FT.includes('${rootDir}/${rel') || FT.includes('`${rootDir}/${name}`') || (FT.match(/rootDir}\//g) ?? []).length >= 4)
ok('全套文件操作走 ws:* IPC 现成通道（create/mkdir/rename/trash/list/read）',
  ['workspaceCreateFile', 'workspaceMkdir', 'workspaceRename', 'workspaceTrash', 'workspaceListDir', 'workspaceReadFile'].every(k => FT.includes(k)))
ok('删除进系统回收站且有危险确认；锚点/隐藏文件禁删',
  FT.includes('showGlobalConfirm') && FT.includes('variant: \'danger\'') && FT.includes("seg.startsWith('.')"))
ok('根节点保护：空白区/合成根只给新建与粘贴菜单（无改名删除）',
  FT.includes("node.relPath === ''"))
ok('拖拽移动复用 ws:rename（与编辑区一致语义）',
  FT.includes('onMove=') && /onMove=\{\(src, dstDir\)[\s\S]*workspaceRename\(/.test(FT))
ok('AI 产物落盘联动：监听 aiTeach:tree-refresh 重扫已展开目录',
  FT.includes('onAiTeachTreeRefresh') && FT.includes('loadedDirsRef'))
ok('右键菜单（新建/重命名/复制剪贴/副本/复制路径/删除）与输入弹窗',
  ['新建文件', '新建文件夹', '重命名', '复制（到剪贴板）', '创建副本', '复制路径', '删除（回收站）'].every(s => FT.includes(s)))
ok('md 点击 → 中栏阅读（§3.9-2 方案 B），非 md → 编辑器标签页',
  FT.includes('onOpenMd') && FT.includes('onOpenExternal'))

ok('模块：VS Code 多分区侧栏（资源管理器/会话/任务规划）+ SectionHead 折叠贴靠',
  MOD.includes('SectionHead') && MOD.includes('资源管理器') && MOD.includes('任务规划') && MOD.includes('AiTeachFileTree'))
ok('折叠状态记忆持久化（sections/左右侧栏收放 localStorage）',
  MOD.includes("'aiTeach.sections.collapsed'") && MOD.includes("'aiTeach.leftOpen'") && MOD.includes("'aiTeach.rightOpen'"))
ok('阅读视图：workspaceReadFile → MarkdownPreview 宽幅渲染（max-w 820）',
  MOD.includes('workspaceReadFile') && MOD.includes('openDocView') && MOD.includes('max-w-[820px]') && MOD.includes('<MarkdownPreview content={docView.content} />'))
ok('阅读视图工具行：返回对话 / 文件名 / 在编辑器中打开 ↗',
  MOD.includes('返回对话') && MOD.includes('在编辑器中打开') && MOD.includes("kb-open-in-editor"))
ok('右缘大纲栏：渲染后 DOM 收集 h2/h3 + CSS.escape 定位',
  MOD.includes("querySelectorAll('h2, h3')") && MOD.includes('CSS.escape') && MOD.includes('docOutline'))
ok('滚动位置记忆：按文件 rel 记录并在打开时恢复',
  MOD.includes('docScrollPos') && MOD.includes('docScrollRef.current.scrollTop'))
ok('渲染优先级：docView > reader > 对话流（互斥接管）',
  MOD.includes('docView ? (') && MOD.includes(') : !reader ? (') && MOD.includes('docView > reader'))
ok('「✓ 已生成文档 →」改为中栏阅读入口（方案 B 入口②）',
  MOD.includes('void openDocView(existing)'))
ok('切会话/新建任务退出阅读视图',
  (MOD.match(/setDocView\(null\)/g) ?? []).length >= 3)
ok('资源管理器接树广播所需根设置与全路径拼接',
  MOD.includes('getSettingRaw(\'aiTeachRootDir\')') && MOD.includes('${aiTeachRoot}/'))

console.log(`\n结果: ${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
