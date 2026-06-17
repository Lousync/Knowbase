import { useState, useEffect } from 'react'
import { RotateCcw } from 'lucide-react'
import { setSetting, getAllSettings } from '../../../lib/ipc'
import type { AppSettings } from '../../../lib/settings'

export function AdvancedView() {
  const [s, setS] = useState<AppSettings | null>(null)

  useEffect(() => {
    getAllSettings().then(setS)
  }, [])

  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    if (!s) return
    setS({ ...s, [key]: value })
    setSetting(key, value)
  }

  if (!s) return null

  return (
    <div>
      <h2 className="text-[16px] font-semibold text-[var(--text-primary)] mb-1">高级</h2>
      <p className="text-[12px] text-[var(--text-muted)] mb-6">其他偏好设置</p>

      {/* Zoom */}
      <div className="mb-8">
        <h3 className="text-[12px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-3">缩放</h3>
        <div className="flex items-center gap-4">
          <span className="text-[13px] text-[var(--text-primary)]">
            当前缩放：{Math.round(s.zoom * 100)}%
          </span>
          <button
            onClick={() => { update('zoom', 1.0); document.documentElement.style.fontSize = '16px' }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-[var(--text-primary)] border border-[var(--border-color)] rounded hover:bg-[var(--bg-hover)] transition-colors"
          >
            <RotateCcw size={12} />
            重置缩放
          </button>
        </div>
      </div>

      {/* Delete confirmation */}
      <div className="mb-8">
        <h3 className="text-[12px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-3">删除确认</h3>
        <div className="space-y-2">
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={s.skipDeleteConfirm_blog}
              onChange={() => update('skipDeleteConfirm_blog', !s.skipDeleteConfirm_blog)}
              className="accent-[var(--accent)]" />
            <span className="text-[13px] text-[var(--text-primary)]">跳过博客删除确认对话框</span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={s.skipDeleteConfirm_knowledge}
              onChange={() => update('skipDeleteConfirm_knowledge', !s.skipDeleteConfirm_knowledge)}
              className="accent-[var(--accent)]" />
            <span className="text-[13px] text-[var(--text-primary)]">跳过知识库删除确认对话框</span>
          </label>
        </div>
      </div>

      {/* Auto-save */}
      <div>
        <h3 className="text-[12px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-3">自动保存</h3>
        <div className="text-[13px] text-[var(--text-muted)]">
          编辑器将在停止输入 {s.autoSaveDebounceMs / 1000} 秒后自动保存
        </div>
      </div>
    </div>
  )
}
