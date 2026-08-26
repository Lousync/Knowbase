/**
 * OpenCode（Zen/Go 端点）模型目录 —— 友好名称与免费标记的静态映射。
 * 背景：上游 /models 只返回原始 ID 且不含免费元数据；CC Switch 的美化名来自其本地目录。
 * 维护约定：上游改名/上新时更新此表；未知 ID 回退到机械美化，不会显示错误信息。
 */

/** 实测确认的免费模型（2026-08 对照 opencode Zen/Go 双端点 /models 数据） */
const KNOWN_FREE = new Set([
  // Zen 主端点专属的 -free 后缀族
  'hy3-free',
  'mimo-v2.5-free',
  'muse-spark-1.2-contributor-free',
  'nemotron-3.5-lightning-free',
  'nemotron-3-ultra-free',
  'deepseek-v4-flash-free',
  'laguna-s-2.1-free',
  'x-preview-f-free',
  // Go 端点专属免费
  'ox-alpha-free',
])

/** 手工维护的美化名（仅放无法机械推导或官方写法特殊的条目） */
const PRETTY_OVERRIDES: Record<string, string> = {
  // Zen 免费族
  'hy3-free': 'Hy3 Free',
  'mimo-v2.5-free': 'MiMo V2.5 Free',
  'muse-spark-1.2-contributor-free': 'Muse Spark 1.2 Free',
  'nemotron-3.5-lightning-free': 'Nemotron 3.5 Lightning Free',
  'nemotron-3-ultra-free': 'Nemotron 3 Ultra Free',
  'deepseek-v4-flash-free': 'DeepSeek V4 Flash Free',
  'laguna-s-2.1-free': 'Laguna S 2.1 Free',
  'x-preview-f-free': 'X Preview F Free',
  // Go 端点（注意：不带 -free 后缀的是付费版，勿标免费）
  'hy3': 'Hy3',
  'hy3-preview': 'Hy3 Preview',
  'mimo-v2.5': 'MiMo V2.5',
  'mimo-v2.5-pro': 'MiMo V2.5 Pro',
  'mimo-v2.5-omni': 'MiMo V2.5 Omni',
  'muse-spark-1.2-contributor': 'Muse Spark 1.2 Contributor',
  'muse-spark-1.2': 'Muse Spark 1.2',
  'ox-alpha-free': 'Ox Alpha Free (Unlimited)',
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
