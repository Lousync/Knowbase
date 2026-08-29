/**
 * 知识包内部溯源标签识别（如 408 的 kb-ds-3-4-3-4）。
 * 这类标签是插件 manifest 的块级溯源 ID，应用代码零引用、对用户无意义，
 * 渲染层一律隐藏，避免污染标签体系（库中数据保留，不影响插件生态）。
 */
export function isInternalKnowledgeTag(name: string): boolean {
  return /^kb-/i.test(name)
}

/** 过滤出对用户可见的标签 */
export function visibleKnowledgeTags<T extends { name: string }>(tags: T[]): T[] {
  return tags.filter(t => !isInternalKnowledgeTag(t.name))
}
