import { useState, useEffect, useCallback } from 'react'
import { X, AlertCircle, AlertTriangle, Info, ExternalLink } from 'lucide-react'
import type { ToastMessage } from '../../lib/toast'
import { navigateToSettingsSection } from '../../modules/settings'

interface ActiveToast extends ToastMessage {
  progress: number   // 0..1, 1 = done
}

export function Toast() {
  const [toasts, setToasts] = useState<ActiveToast[]>([])

  const remove = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  useEffect(() => {
    const onShow = (e: Event) => {
      const msg = (e as CustomEvent<ToastMessage>).detail
      setToasts(prev => [...prev, { ...msg, progress: 0 }])
    }
    const onDismiss = (e: Event) => {
      const id = (e as CustomEvent<string>).detail
      remove(id)
    }

    window.addEventListener('toast:show', onShow)
    window.addEventListener('toast:dismiss', onDismiss)
    return () => {
      window.removeEventListener('toast:show', onShow)
      window.removeEventListener('toast:dismiss', onDismiss)
    }
  }, [remove])

  // Progress animation
  useEffect(() => {
    if (toasts.length === 0) return
    const tick = 50 // ms
    const timer = setInterval(() => {
      setToasts(prev =>
        prev.map(t => {
          const duration = t.duration ?? 5000
          const delta = tick / duration
          const next = t.progress + delta
          if (next >= 1) {
            // Auto-dismiss
            setTimeout(() => remove(t.id), 0)
            return t // will be filtered next frame
          }
          return { ...t, progress: next }
        })
      )
    }, tick)
    return () => clearInterval(timer)
  }, [toasts.length, remove])

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-3 pointer-events-none">
      {toasts.map(t => (
        <ToastItem key={t.id} toast={t} onDismiss={remove} />
      ))}
    </div>
  )
}

function ToastItem({ toast: t, onDismiss }: { toast: ActiveToast; onDismiss: (id: string) => void }) {
  const Icon = t.type === 'error' ? AlertCircle : t.type === 'warning' ? AlertTriangle : Info
  const iconColor = t.type === 'error' ? 'text-[#f14c4c]' : t.type === 'warning' ? 'text-[#cca700]' : 'text-[var(--accent)]'
  const borderColor = t.type === 'error' ? 'border-[#f14c4c]' : t.type === 'warning' ? 'border-[#cca700]' : 'border-[var(--accent)]'

  const handleDetail = () => {
    if (t.detail) {
      navigateToSettingsSection(t.detail as 'shortcuts' | 'editor' | 'appearance' | 'export' | 'advanced')
    }
    onDismiss(t.id)
  }

  return (
    <div
      className={`pointer-events-auto bg-[var(--bg-secondary)] border ${borderColor} border-l-[3px] rounded-lg shadow-2xl w-[380px] overflow-hidden`}
    >
      <div className="flex items-start gap-3 px-4 pt-3 pb-2">
        <Icon size={16} className={`shrink-0 mt-0.5 ${iconColor}`} />

        <div className="flex-1 min-w-0">
          <p className="text-[13px] text-[var(--text-primary)] leading-relaxed">{t.message}</p>

          {(t.detail || t.type === 'error') && (
            <div className="flex items-center gap-2 mt-2">
              {t.detail && (
                <button
                  onClick={handleDetail}
                  className="flex items-center gap-1 text-[11px] text-[var(--accent)] hover:text-[var(--accent-hover)] transition-colors"
                >
                  <ExternalLink size={10} />
                  查看详情
                </button>
              )}
            </div>
          )}
        </div>

        <button
          onClick={() => onDismiss(t.id)}
          className="p-0.5 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors shrink-0"
        >
          <X size={14} />
        </button>
      </div>

      {/* Progress bar */}
      <div className="h-[3px] bg-[var(--bg-tertiary)]">
        <div
          className={`h-full transition-all ease-linear ${t.progress >= 1 ? 'bg-transparent' : t.type === 'error' ? 'bg-[#f14c4c]' : t.type === 'warning' ? 'bg-[#cca700]' : 'bg-[var(--accent)]'}`}
          style={{ width: `${Math.min(t.progress * 100, 100)}%` }}
        />
      </div>
    </div>
  )
}
