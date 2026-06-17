import { useSettings } from '../../../lib/SettingsContext'
import { FONT_OPTIONS, FONT_CSS_MAP } from '../../../lib/settings'

export function EditorView() {
  const { s, update } = useSettings()

  return (
    <div>
      <h2 className="text-[16px] font-semibold text-[var(--text-primary)] mb-1">编辑器</h2>
      <p className="text-[12px] text-[var(--text-muted)] mb-6">自定义编辑器行为和外观</p>

      <div className="mb-8">
        <h3 className="text-[12px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-3">字体样式</h3>
        <div className="space-y-1.5 max-w-xs">
          {FONT_OPTIONS.map(f => (
            <button
              key={f.id}
              onClick={() => {
                update('editorFont', f.id)
                if (FONT_CSS_MAP[f.id]) {
                  document.documentElement.style.setProperty('--font-sans', FONT_CSS_MAP[f.id])
                }
              }}
              className={`w-full text-left px-3 py-2 rounded text-[13px] transition-colors ${
                s.editorFont === f.id
                  ? 'bg-[var(--bg-selected)] text-[var(--text-primary)] border border-[var(--accent)]'
                  : 'text-[var(--text-secondary)] border border-transparent hover:bg-[var(--bg-hover)]'
              }`}
            >
              {f.label}
              <div className="text-[10px] text-[var(--text-muted)] mt-0.5 font-mono">
                {FONT_CSS_MAP[f.id].split(',')[0].replace(/'/g, '')}
              </div>
            </button>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-[12px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-3">显示</h3>
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={s.showLineNumbers}
            onChange={() => update('showLineNumbers', !s.showLineNumbers)}
            className="accent-[var(--accent)]" />
          <span className="text-[13px] text-[var(--text-primary)]">显示行号</span>
        </label>
      </div>
    </div>
  )
}
