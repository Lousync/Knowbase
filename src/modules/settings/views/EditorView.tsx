import { useState, useEffect } from 'react'
import { getSetting, setSetting } from '../../../lib/ipc'

const FONTS = [
  { id: 'system', label: '系统默认', value: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', sans-serif" },
  { id: 'yahei', label: '微软雅黑', value: "'Microsoft YaHei', '微软雅黑', sans-serif" },
  { id: 'noto', label: '思源黑体', value: "'Source Han Sans SC', 'Noto Sans SC', 'Microsoft YaHei', sans-serif" },
  { id: 'mono', label: '等宽字体', value: "'Cascadia Code', 'Fira Code', 'Consolas', 'Microsoft YaHei', monospace" },
]

export function EditorView() {
  const [font, setFont] = useState('system')
  const [showLineNumbers, setShowLineNumbers] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    Promise.all([getSetting('editorFont'), getSetting('showLineNumbers')]).then(([f, ln]) => {
      if (typeof f === 'string') setFont(f)
      if (typeof ln === 'boolean') setShowLineNumbers(ln)
      setLoaded(true)
    })
  }, [])

  const handleFontChange = (id: string) => {
    setFont(id)
    setSetting('editorFont', id)
    const fontDef = FONTS.find(f => f.id === id)
    if (fontDef) {
      document.documentElement.style.setProperty('--font-sans', fontDef.value)
    }
  }

  const handleLineNumbersToggle = () => {
    const next = !showLineNumbers
    setShowLineNumbers(next)
    setSetting('showLineNumbers', next)
  }

  if (!loaded) return null

  return (
    <div>
      <h2 className="text-[16px] font-semibold text-[var(--text-primary)] mb-1">编辑器</h2>
      <p className="text-[12px] text-[var(--text-muted)] mb-6">自定义编辑器行为和外观</p>

      {/* Font selection */}
      <div className="mb-8">
        <h3 className="text-[12px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-3">字体样式</h3>
        <div className="space-y-1.5 max-w-xs">
          {FONTS.map(f => (
            <button
              key={f.id}
              onClick={() => handleFontChange(f.id)}
              className={`w-full text-left px-3 py-2 rounded text-[13px] transition-colors ${
                font === f.id
                  ? 'bg-[var(--bg-selected)] text-[var(--text-primary)] border border-[var(--accent)]'
                  : 'text-[var(--text-secondary)] border border-transparent hover:bg-[var(--bg-hover)]'
              }`}
            >
              {f.label}
              <div className="text-[10px] text-[var(--text-muted)] mt-0.5 font-mono">
                {f.value.split(',')[0].replace(/'/g, '')}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Line numbers */}
      <div>
        <h3 className="text-[12px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-3">显示</h3>
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={showLineNumbers}
            onChange={handleLineNumbersToggle}
            className="accent-[var(--accent)]"
          />
          <span className="text-[13px] text-[var(--text-primary)]">显示行号</span>
        </label>
      </div>
    </div>
  )
}
