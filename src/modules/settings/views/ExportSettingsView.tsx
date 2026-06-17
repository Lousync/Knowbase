import { useState, useEffect } from 'react'
import { setSetting, getAllSettings } from '../../../lib/ipc'
import { ENCODING_OPTIONS } from '../../../lib/settings'
import type { AppSettings } from '../../../lib/settings'

export function ExportSettingsView() {
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
      <h2 className="text-[16px] font-semibold text-[var(--text-primary)] mb-1">导出</h2>
      <p className="text-[12px] text-[var(--text-muted)] mb-6">自定义数据导出行为</p>

      <div className="mb-8">
        <h3 className="text-[12px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-3">默认编码</h3>
        <div className="space-y-1.5 max-w-xs">
          {ENCODING_OPTIONS.map(e => (
            <button
              key={e.id}
              onClick={() => {
                update('exportEncoding', e.id)
                window.dispatchEvent(new CustomEvent('settings-encoding-changed', { detail: e.id }))
              }}
              className={`w-full text-left px-3 py-2 rounded text-[13px] transition-colors ${
                s.exportEncoding === e.id
                  ? 'bg-[var(--bg-selected)] text-[var(--text-primary)] border border-[var(--accent)]'
                  : 'text-[var(--text-secondary)] border border-transparent hover:bg-[var(--bg-hover)]'
              }`}
            >
              <span className="font-medium">{e.label}</span>
              <span className="ml-2 text-[10px] text-[var(--text-muted)]">{e.desc}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
