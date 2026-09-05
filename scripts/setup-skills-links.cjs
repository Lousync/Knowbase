/**
 * Agent Skills 目录联接（junction）一键重建
 *
 * 设计：所有 agent 工具共享一份 skill，真实内容存放在 `.agents/skills/`，
 * 各工具的约定目录通过 Windows junction 指向它，新增/修改 skill 只改一处。
 *
 * 用法：node scripts/setup-skills-links.cjs
 * 适用场景：新 clone 仓库后、新增 agent 工具后执行；幂等，可重复运行。
 *
 * 注意：skill 内容按项目约定不入 git（.agents/ 已在 .gitignore），
 * 换机器后需重新执行本脚本并重装 skill 内容。
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const SOURCE = path.join(ROOT, '.agents', 'skills')

/**
 * 各 agent 工具的项目级 skill 目录约定：
 * - Claude Code : .claude/skills
 * - Trae CN     : .trae/skills
 * 新工具按其文档在此追加一行即可。
 */
const TOOL_LINKS = [
  { tool: 'Claude Code', link: path.join(ROOT, '.claude', 'skills') },
  { tool: 'Trae CN', link: path.join(ROOT, '.trae', 'skills') },
]

if (!fs.existsSync(path.join(SOURCE, 'frontend-design'))) {
  console.error(`[skills] 单一源不存在或为空: ${SOURCE}`)
  console.error('[skills] 请先安装/恢复 skill 内容后再运行本脚本')
  process.exit(1)
}

let created = 0
for (const { tool, link } of TOOL_LINKS) {
  if (fs.existsSync(link)) {
    const real = fs.realpathSync(link)
    if (real === fs.realpathSync(SOURCE)) {
      console.log(`[skills] ${tool}: 已就绪  ${path.relative(ROOT, link)}`)
      continue
    }
    console.warn(`[skills] ${tool}: 目标已存在但不是指向单一源的联接（${path.relative(ROOT, link)}），跳过，请人工处理`)
    continue
  }
  fs.mkdirSync(path.dirname(link), { recursive: true })
  // junction 类型在 Windows 上无需管理员权限
  fs.symlinkSync(SOURCE, link, 'junction')
  created++
  console.log(`[skills] ${tool}: 已创建联接  ${path.relative(ROOT, link)} → .agents/skills`)
}

console.log(`[skills] 完成：${created} 个新联接，共 ${TOOL_LINKS.length} 个工具`)
