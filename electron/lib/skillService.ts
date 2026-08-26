import { ipcMain, clipboard } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync } from 'fs'
import { getPluginsRoot, getInstalledIndex, onPluginsChanged } from './pluginRegistry'
import { registerTool, unregisterToolsByPrefix } from './aiTools'
import type { ToolJsonSchema } from './aiTools'

/**
 * Skill 包体系（M3，方案 .claude/plans/agent-tools-foundation.md 第七节）：
 * - Skill 是插件贡献的「声明式提示词资产」，不是可执行工具
 * - 聚合已启用插件的 contributes.skills，登记进 ToolRegistry（skill.<pluginId>.<skillId>），
 *   入参 schema 由变量列表生成；调用 = 返回变量替换后的提示词文本
 * - 消费端在下一期 AgentRunner 接上；本期提供管理/浏览/复制
 */

interface SkillContribution {
  id: string
  title: string
  description?: string
  prompt: string
  variables?: string[]
  tools?: string[]
}

export interface SkillInfo {
  pluginId: string
  pluginName: string
  registryName: string
  id: string
  title: string
  description: string
  prompt: string
  variables: string[]
  /** 声明依赖的工具（展示用途） */
  tools: string[]
}

// ---- 读取已装插件的 skills 贡献 ----

function readEnabledSkills(): SkillInfo[] {
  const out: SkillInfo[] = []
  let index: Record<string, { enabled?: boolean }> = {}
  try { index = getInstalledIndex() as Record<string, { enabled?: boolean }> } catch { return out }

  for (const [pluginId, entry] of Object.entries(index)) {
    if (!entry?.enabled) continue
    const manifestPath = join(getPluginsRoot(), pluginId, 'plugin.json')
    if (!existsSync(manifestPath)) continue
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as {
        name?: string
        contributes?: { skills?: SkillContribution[] }
      }
      const skills = manifest.contributes?.skills
      if (!Array.isArray(skills)) continue
      for (const s of skills) {
        if (!s || typeof s.id !== 'string' || typeof s.prompt !== 'string') continue
        out.push({
          pluginId,
          pluginName: manifest.name || pluginId,
          registryName: `skill.${pluginId}.${s.id}`,
          id: s.id,
          title: s.title || s.id,
          description: s.description || '',
          prompt: s.prompt,
          variables: Array.isArray(s.variables) ? s.variables.map(String) : [],
          tools: Array.isArray(s.tools) ? s.tools.map(String) : [],
        })
      }
    } catch { /* 清单损坏的插件跳过 */ }
  }
  return out
}

// ---- 提示词渲染 ----

function renderPrompt(prompt: string, args: Record<string, unknown>): string {
  return prompt.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (raw, name: string) => {
    const v = args[name]
    return v === undefined || v === null ? raw : String(v)
  })
}

// ---- 注册表同步 ----

/** 全量重建 skill.* 注册项（禁用/卸载插件后其 Skill 即从注册表消失） */
export function refreshSkillRegistrations(): void {
  unregisterToolsByPrefix('skill.')
  for (const s of readEnabledSkills()) {
    const properties: ToolJsonSchema['properties'] = {}
    for (const v of s.variables) properties[v] = { type: 'string', description: `提示词变量 {{${v}}}` }
    registerTool({
      name: s.registryName,
      title: s.title,
      description: `[Skill] ${s.description || s.title}（变量: ${s.variables.join(', ') || '无'}）`,
      inputSchema: { type: 'object', properties, required: s.variables },
      source: 'skill',
      enabled: true,
      readOnly: true,
    }, (args) => ({ skillId: s.id, pluginId: s.pluginId, prompt: renderPrompt(s.prompt, args) }))
  }
}

// ---- IPC ----

export function registerSkillHandlers(): void {
  // 同步刷新：保证启停/卸载返回后注册表状态立即一致（开销为少量清单读取，可忽略）
  onPluginsChanged(() => refreshSkillRegistrations())
  // 启动时先同步一次（内置插件落位发生在 pluginRegistry 注册阶段之后）
  refreshSkillRegistrations()

  ipcMain.handle('aiTools:listSkills', () => ({
    skills: readEnabledSkills().map(({ prompt: _p, ...rest }) => rest),
  }))

  // 复制提示词全文到剪贴板（主进程代理，避免渲染层直连 clipboard 的权限面扩大）
  ipcMain.handle('aiTools:copySkillPrompt', (_e, pluginId: string, skillId: string) => {
    if (typeof pluginId !== 'string' || typeof skillId !== 'string') return false
    const s = readEnabledSkills().find(x => x.pluginId === pluginId && x.id === skillId)
    if (!s) return false
    clipboard.writeText(s.prompt)
    return true
  })
}
