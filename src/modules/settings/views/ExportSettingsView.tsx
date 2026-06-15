import { useState, useEffect } from 'react'
import { getSetting, setSetting } from '../../../lib/ipc'

const ENCODINGS = [
  { id: 'utf-8', label: 'UTF-8', desc: '国际通用编码，推荐使用' },
  { id: 'gbk', label: 'GBK', desc: '中文编码（Windows 默认）' },
  { id: 'gb2312', label: 'GB2312', desc: '简体中文编码（较早标准）' },
]

export function ExportSettingsView() {
  const [encoding, setEncoding] = useState('utf-8')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    getSetting('exportEncoding').then(v => {
      if (typeof v === 'string') setEncoding(v)
      setLoaded(true)
    })
  }, [])

  const handleEncodingChange = (id: string) => {
    setEncoding(id)
    setSetting('exportEncoding', id)
    window.dispatchEvent(new CustomEvent('settings-encoding-changed', { detail: id }))
  }

  if (!loaded) return null

  return (
    <div>
      <h2 className="text-[16px] font-semibold text-[var(--text-primary)] mb-1">导出</h2>
      <p className="text-[12px] text-[var(--text-muted)] mb-6">自定义数据导出行为</p>

      {/* Encoding */}
      <div className="mb-8">
        <h3 className="text-[12px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-3">默认编码</h3>
        <div className="space-y-1.5 max-w-xs">
          {ENCODINGS.map(e => (
            <button
              key={e.id}
              onClick={() => handleEncodingChange(e.id)}
              className={`w-full text-left px-3 py-2 rounded text-[13px] transition-colors ${
                encoding === e.id
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
