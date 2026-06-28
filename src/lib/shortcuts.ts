export function isEditingInput(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement
  const tag = el?.tagName?.toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select' || el?.isContentEditable === true) return true
  // Monaco editor: don't steal Ctrl+C/X/V/A from the editor
  if (el?.closest('.monaco-editor')) return true
  return false
}
