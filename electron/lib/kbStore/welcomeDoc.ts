import { randomUUID } from 'crypto'
import { existsSync, writeFileSync } from 'fs'
import { join } from 'path'

/**
 * 新仓库欢迎文档（2026-09-08）：
 * - 仅在仓库「首次初始化」（.knowbase/meta.json 尚不存在）时写入仓库根 欢迎.md
 * - 它是普通用户文档：不登记 SOFT_ENTRY_NAMES、可编辑可删除，知识库/图谱/搜索正常索引
 * - 写入失败静默跳过（不阻断仓库创建）
 */

export const WELCOME_DOC_FILENAME = '欢迎.md'

/** frontmatter 字段与编辑器新建口径一致（id/title/tags/created/updated）；欢迎文档直接 published */
export function buildWelcomeDocContent(now = new Date()): string {
  const ts = now.toISOString()
  const body = `欢迎使用 Knowbase！这是一份为你准备的导览，读完大约 3 分钟。删掉它没有任何影响。

## 先理解三件事

1. **仓库 = 一个普通文件夹**。你现在看到的所有笔记都是仓库文件夹里的 .md 文件，用任何编辑器（包括 VS Code、Obsidian）都能直接打开，没有私有格式锁定。
2. **编辑器是唯一的写入方**。左侧「编辑器」模块里写 .md；写好的文档在右侧「知识库」模块中阅读、检索、复习。
3. **\`.knowbase/\` 是软件内部数据**（书签、日程、密码本等结构化数据都在里面），请勿手工改动；它和 \`.attachments/\`（插图附件区）一样以 \`.\` 开头，在文件树里收进底部「软件文件」折叠节。

## 功能导览

| 模块 | 用来做什么 |
|------|-----------|
| 编辑器 | 写笔记：Monaco 编辑、目录树、插图（自动存入 .attachments）、归档后进知识库 |
| 知识库 | 沉浸阅读、标签/全文搜索、双链（[[wiki 链接]]）、星标、配套 quiz 复习 |
| 图谱 | 知识网络可视化：按双链与引用自动连线，支持缩放/拖拽/定位 |
| 博客 | 博客文章写作与管理，可整体导出静态站点 |
| 日程 / 说说 | 每日日程安排与碎片化记录（说说支持心情与图片） |
| 工具箱 | 网址导航（支持导入 Chrome/Edge/Firefox 收藏夹）、密码本、局域网互传等 |
| AI | 内置 AI 助手：对话、笔记问答、Agent 工具调用（可在设置里配模型与 MCP） |
| 插件 | 插件市场：安装社区技能与功能扩展 |
| 帮助 | 各模块完整使用手册（本导览只是缩略版） |

## 上手建议

- 在编辑器新建一篇文档 → 写几句 → 右键「归档」→ 去知识库看它出现
- 用 \`[[另一篇笔记]]\` 语法建立双链，然后打开图谱看连线生长
- 把常用网站丢进工具箱的网址导航，或直接导入浏览器收藏夹
- 右下角「帮助」模块有每个功能的详细说明，遇到问题先去那里找
`

  return `---\nid: ${randomUUID()}\ntitle: 欢迎\ntags: [指南]\nstarred: false\ncreated: ${ts}\nupdated: ${ts}\n---\n\n${body}`
}

/** 幂等写入：仓库根已存在 欢迎.md 时跳过。返回是否实际写入。失败不抛错（不阻断仓库创建） */
export function writeWelcomeDocOnce(rootPath: string): boolean {
  try {
    const target = join(rootPath, WELCOME_DOC_FILENAME)
    if (existsSync(target)) return false
    writeFileSync(target, buildWelcomeDocContent(), 'utf-8')
    return true
  } catch {
    return false
  }
}
