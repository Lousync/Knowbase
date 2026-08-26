export function isEditingInput(e: KeyboardEvent): boolean {
  // 合成事件（如程序化 dispatch）的 target 可能是 window 等非元素对象
  const el = e.target instanceof HTMLElement ? e.target : null
  const tag = el?.tagName?.toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select' || el?.isContentEditable === true) return true
  // Monaco editor: don't steal Ctrl+C/X/V/A from the editor
  if (el?.closest('.monaco-editor')) return true
  return false
}
