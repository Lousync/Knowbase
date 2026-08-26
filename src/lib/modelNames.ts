/**
 * OpenCode（Zen/Go 端点）模型目录 —— 友好名称与免费标记的静态映射。
 * 背景：上游 /models 只返回原始 ID 且不含免费元数据；CC Switch 的美化名来自其本地目录。
 * 维护约定：上游改名/上新时更新此表；未知 ID 回退到机械美化，不会显示错误信息。
 */

/** 实测确认的免费模型（截图对照 CC Switch） */
const KNOWN_FREE = new Set([
  'ox-alpha-free',
  'mimo-v2.5',
  'hy3',
  'hy3-preview',
  'muse-spark-1.2-contributor',
  'nemotron-3.5-lightning',
  'nemotron-3.5-lightning-free',
])

/** 手工维护的美化名（仅放无法机械推导或官方写法特殊的条目） */
const PRETTY_OVERRIDES: Record<string, string> = {
  'hy3': 'Hy3 Free',
  'hy3-preview': 'Hy3 Preview Free',
  'mimo-v2.5': 'MiMo V2.5 Free',
  'mimo-v2.5-pro': 'MiMo V2.5 Pro',
  'mimo-v2.5-omni': 'MiMo V2.5 Omni',
  'muse-spark-1.2-contributor': 'Muse Spark 1.2 Free',
  'ox-alpha-free': 'Ox Alpha Free (Unlimited)',
  'nemotron-3.5-lightning': 'Nemotron 3.5 Lightning Free',
  'nemotron-3.5-lightning-free': 'Nemotron 3.5 Lightning Free',
  'longcat-2.0': 'LongCat 2.0',
  'gpt-5.6-luna': 'GPT-5.6 Luna',
}

/** 品牌词大小写表（机械美化用） */
const BRAND_CASE: Record<string, string> = {
  glm: 'GLM', gpt: 'GPT', ai: 'AI', llm: 'LLM', ocr: 'OCR',
}

/** 品牌前缀 → 展示名（首段匹配即整组替换） */
const BRAND_PREFIX: Record<string, string> = {
  kimi: 'Kimi', deepseek: 'DeepSeek', qwen: 'Qwen', grok: 'Grok',
  minimax: 'MiniMax', mimo: 'MiMo', nemotron: 'Nemotron', longcat: 'LongCat',
}

/** 模型 ID → 友好名称（未知 ID 机械美化：分段+品牌大小写） */
export function prettyModelName(id: string): string {
  if (PRETTY_OVERRIDES[id]) return PRETTY_OVERRIDES[id]
  const parts = id.split('-')
  const first = parts[0]?.toLowerCase() ?? ''
  if (BRAND_PREFIX[first]) {
    const rest = parts.slice(1).map(p => p.toUpperCase()).join(' ')
    return `${BRAND_PREFIX[first]} ${rest}`.trim()
  }
  return parts.map(p => {
    const lower = p.toLowerCase()
    if (BRAND_CASE[lower]) return BRAND_CASE[lower]
    return p.charAt(0).toUpperCase() + p.slice(1)
  }).join(' ')
}

/** 是否目录内已知的免费模型 */
export function isOpenCodeFree(id: string): boolean {
  return KNOWN_FREE.has(id.toLowerCase())
}
