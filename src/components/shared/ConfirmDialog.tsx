import { useState } from 'react'

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

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onCancel}>
      <div
        className="bg-[#252526] border border-[#3c3c3c] rounded-lg w-[420px] shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3 border-b border-[#3c3c3c]">
          <h3 className="text-[14px] font-medium text-[#cccccc]">{title}</h3>
        </div>

        {/* Body */}
        <div className="px-5 py-4">
          <p className="text-[13px] text-[#969696] leading-relaxed">{message}</p>

          {showCheckbox && (
            <label className="flex items-center gap-2 mt-4 cursor-pointer">
              <input
                type="checkbox"
                checked={skipChecked}
                onChange={e => setSkipChecked(e.target.checked)}
                className="w-4 h-4 accent-[#007acc]"
              />
              <span className="text-[12px] text-[#969696]">{checkboxLabel}</span>
            </label>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-[#3c3c3c]">
          <button
            onClick={onCancel}
            className="px-4 py-1.5 text-[13px] text-[#969696] hover:text-[#cccccc] transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={() => onConfirm(skipChecked)}
            className={
              variant === 'danger'
                ? 'px-4 py-1.5 text-[13px] bg-[#e81123] text-white rounded hover:bg-[#d01020] transition-colors'
                : 'px-4 py-1.5 text-[13px] bg-[#007acc] text-white rounded hover:bg-[#1a8ad4] transition-colors'
            }
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
