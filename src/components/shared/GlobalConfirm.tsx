import { useEffect, useState } from 'react'
import { setGlobalConfirmHandler, type GlobalConfirmOptions } from '../../lib/globalConfirm'

/**
 * 全局确认框宿主（App 根部唯一挂载）。showGlobalConfirm() 的渲染端：
 * 样式对齐 ConfirmDialog，无「不再提示」勾选（一次性决策场景）。
 */
export function GlobalConfirm() {
  const [req, setReq] = useState<{ opts: GlobalConfirmOptions; resolve: (ok: boolean) => void } | null>(null)

  useEffect(() => {
    setGlobalConfirmHandler((opts, resolve) => setReq({ opts, resolve }))
    return () => setGlobalConfirmHandler(null)
  }, [])

  useEffect(() => {
    if (!req) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        const { resolve } = req
        setReq(null)
        resolve(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [req])

  if (!req) return null
  const { opts, resolve } = req
  const done = (ok: boolean): void => {
    setReq(null)
    resolve(ok)
  }
  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/50" onClick={() => done(false)}>
      <div
        className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg w-[420px] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-[var(--border-color)]">
          <h3 className="text-[14px] font-medium text-[var(--text-primary)]">{opts.title}</h3>
        </div>
        <div className="px-5 py-4">
          <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap">{opts.message}</p>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-[var(--border-color)]">
          <button
            onClick={() => done(false)}
            className="px-4 py-1.5 text-[13px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            {opts.cancelLabel ?? '取消'}
          </button>
          <button
            autoFocus
            onClick={() => done(true)}
            className={
              opts.variant === 'danger'
                ? 'px-4 py-1.5 text-[13px] bg-[var(--danger)] text-white rounded hover:bg-[#d01020] transition-colors'
                : 'px-4 py-1.5 text-[13px] bg-[var(--accent)] text-white rounded hover:bg-[var(--accent-hover)] transition-colors'
            }
          >
            {opts.confirmLabel ?? '确定'}
          </button>
        </div>
      </div>
    </div>
  )
}
