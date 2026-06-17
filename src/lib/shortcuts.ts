export function isEditingInput(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement
  const tag = el?.tagName?.toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select'
    || el?.isContentEditable === true
}
