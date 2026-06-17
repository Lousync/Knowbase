import { useState, useEffect } from 'react'

interface ConfirmDialogProps {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  checkboxLabel?: string
  showCheckbox?: boolean
  variant?: 'danger' | 'default'
  onConfirm: (skipNext: boolean) => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = '删除',
  cancelLabel = '取消',
  checkboxLabel = '不再提示',
  showCheckbox = true,
  variant = 'danger',
  onConfirm,
  onCancel
}: ConfirmDialogProps) {
  const [skipChecked, setSkipChecked] = useState(false)

  // Escape key closes dialog
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        onCancel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onCancel}>
      <div
        className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg w-[420px] shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3 border-b border-[var(--border-color)]">
          <h3 className="text-[14px] font-medium text-[var(--text-primary)]">{title}</h3>
        </div>

        {/* Body */}
        <div className="px-5 py-4">
          <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed">{message}</p>

          {showCheckbox && (
            <label className="flex items-center gap-2 mt-4 cursor-pointer">
              <input
                type="checkbox"
                checked={skipChecked}
                onChange={e => setSkipChecked(e.target.checked)}
                className="w-4 h-4 accent-[var(--accent)]"
              />
              <span className="text-[12px] text-[var(--text-secondary)]">{checkboxLabel}</span>
            </label>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-[var(--border-color)]">
          <button
            onClick={onCancel}
            className="px-4 py-1.5 text-[13px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={() => onConfirm(skipChecked)}
            className={
              variant === 'danger'
                ? 'px-4 py-1.5 text-[13px] bg-[var(--danger)] text-white rounded hover:bg-[#d01020] transition-colors'
                : 'px-4 py-1.5 text-[13px] bg-[var(--accent)] text-white rounded hover:bg-[var(--accent-hover)] transition-colors'
            }
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
