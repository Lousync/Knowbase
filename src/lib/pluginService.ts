import { pluginListInstalled, pluginGetContribution } from './ipc'
import type { PluginSummary } from '../types'

/**
 * 插件贡献内容读取服务(渲染层)。
 * 各模块挂载点(模板弹层/主题列表/番茄钟预设/帮助文档)通过这里
 * 以"虚拟合并"方式读取已启用插件的声明式贡献,不污染用户数据表。
 */

export interface PluginBlogTemplate { id: string; name: string; contentMd: string; pluginName: string }
export interface PluginTheme { id: string; name: string; pluginName: string }
export interface PluginPomodoroPreset { label: string; work: number; break: number; pluginName: string }
export interface PluginHelpDoc { id: string; title: string; category: string; icon: string; md: string }

async function getEnabledContributions(key: string): Promise<{ pluginId: string; pluginName: string; data: unknown }[]> {
  let installed: PluginSummary[] = []
  try { installed = await pluginListInstalled() } catch { return [] }
  const out: { pluginId: string; pluginName: string; data: unknown }[] = []
  for (const p of installed) {
    if (!p.enabled || p.broken || !p.contributions.includes(key)) continue
    try {
      const r = await pluginGetContribution(p.id, key)
      if (r.ok && r.data !== undefined) out.push({ pluginId: p.id, pluginName: p.name, data: r.data })
    } catch { /* 单个插件失败跳过 */ }
  }
  return out
}

// ---------- 博客模板 ----------

export async function getPluginBlogTemplates(): Promise<PluginBlogTemplate[]> {
  const list = await getEnabledContributions<{ name?: unknown; contentMd?: unknown }[]>('blogTemplates')
  const out: PluginBlogTemplate[] = []
  for (const item of list) {
    if (!Array.isArray(item.data)) continue
    (item.data as Record<string, unknown>[]).forEach((raw, i) => {
      if (typeof raw?.name !== 'string' || typeof raw?.contentMd !== 'string' || !raw.name.trim()) return
      out.push({ id: `plugin-${item.pluginId}-${i}`, name: raw.name.trim(), contentMd: raw.contentMd, pluginName: item.pluginName })
    })
  }
  return out
}

// ---------- 主题 ----------

export interface PluginThemeWithVars extends PluginTheme { colors: Record<string, string> }

/** CSS 变量名/值白名单消毒,防注入 */
function sanitizeVars(colors: unknown): string[] {
  if (!colors || typeof colors !== 'object') return []
  const out: string[] = []
  for (const [k, v] of Object.entries(colors as Record<string, unknown>)) {
    if (!/^--[a-zA-Z0-9-]{1,64}$/.test(k)) continue
    if (typeof v !== 'string' || !v.length || v.length > 200) continue
    if (/url\s*\(|expression|@|{|}|<|>/i.test(v)) continue
    out.push(`  ${k}: ${v};`)
  }
  return out
}

/** 注入/刷新所有插件主题的 <style>;返回可用插件主题列表(供设置 → 外观展示) */
export async function ensurePluginThemeStyles(): Promise<PluginThemeWithVars[]> {
  const list = await getEnabledContributions<Record<string, unknown>>('theme')
  const themes: PluginThemeWithVars[] = []
  const rules: string[] = []
  for (const item of list) {
    const d = item.data as { name?: unknown; colors?: unknown }
    const vars = sanitizeVars(d?.colors)
    if (typeof d?.name !== 'string' || !d.name.trim() || vars.length === 0) continue
    const themeId = `plugin-${item.pluginId}`
    themes.push({ id: themeId, name: d.name.trim(), pluginName: item.pluginName, colors: d.colors as Record<string, string> })
    rules.push(`html.theme-${themeId} {\n${vars.join('\n')}\n}`)
  }
  document.getElementById('kb-plugin-themes')?.remove()
  const style = document.createElement('style')
  style.id = 'kb-plugin-themes'
  style.textContent = rules.join('\n')
  document.head.appendChild(style)
  return themes
}

// ---------- 番茄钟预设 ----------

export async function getPluginPomodoroPresets(): Promise<PluginPomodoroPreset[]> {
  const list = await getEnabledContributions<{ label?: unknown; work?: unknown; break?: unknown }[]>('pomodoroPresets')
  const out: PluginPomodoroPreset[] = []
  for (const item of list) {
    if (!Array.isArray(item.data)) continue
    for (const raw of item.data) {
      const work = Math.round(Number(raw?.work))
      const brk = Math.round(Number(raw?.break))
      if (!Number.isFinite(work) || work < 1 || work > 180) continue
      if (!Number.isFinite(brk) || brk < 0 || brk > 60) continue
      out.push({
        label: typeof raw?.label === 'string' && raw.label.trim() ? raw.label.trim() : `${work}min`,
        work, break: brk, pluginName: item.pluginName,
      })
    }
  }
  return out
}

// ---------- 帮助文档 ----------

export async function getPluginHelpDocs(): Promise<PluginHelpDoc[]> {
  const list = await getEnabledContributions<{ title?: unknown; category?: unknown; icon?: unknown; contentMd?: unknown }[]>('helpDocs')
  const out: PluginHelpDoc[] = []
  for (const item of list) {
    if (!Array.isArray(item.data)) continue
    (item.data as Record<string, unknown>[]).forEach((raw, i) => {
      if (typeof raw?.title !== 'string' || typeof raw?.contentMd !== 'string' || !raw.title.trim()) return
      out.push({
        id: `plugin-${item.pluginId}-${i}`,
        title: raw.title.trim(),
        category: typeof raw.category === 'string' && raw.category.trim() ? raw.category.trim() : '插件',
        icon: typeof raw.icon === 'string' && raw.icon.trim() ? raw.icon.trim() : 'Puzzle',
        md: raw.contentMd,
      })
    })
  }
  return out
}
