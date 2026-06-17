export interface ToastMessage {
  id: string
  type: 'error' | 'warning' | 'info'
  message: string
  detail?: string   // help section id: 'shortcuts' | 'editor' | etc.
  duration?: number // ms, default 5000
}

export function showToast(msg: Omit<ToastMessage, 'id'> & { id?: string }): string {
  const id = msg.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  window.dispatchEvent(new CustomEvent('toast:show', {
    detail: { ...msg, id } as ToastMessage,
  }))
  return id
}

export function dismissToast(id: string): void {
  window.dispatchEvent(new CustomEvent('toast:dismiss', { detail: id }))
}
