import { useSettings } from '../../../lib/SettingsContext'
import { FONT_OPTIONS, FONT_CSS_MAP, FONT_SIZE_OPTIONS } from '../../../lib/settings'
import { SettingSelect } from '../components/SettingSelect'

export function EditorView() {
  const { s, update } = useSettings()

  return (
    <div>
      <h2 className="text-[16px] font-semibold text-[var(--text-primary)] mb-1">编辑器</h2>
      <p className="text-[12px] text-[var(--text-muted)] mb-6">自定义编辑器行为和外观</p>

      <div className="mb-8" data-setting-anchor="editor.font">
        <SettingSelect
          title="字体样式"
          description="编辑器正文使用的字体"
          value={s.editorFont}
          onChange={id => {
            update('editorFont', id)
            if (FONT_CSS_MAP[id]) {
              document.documentElement.style.setProperty('--font-sans', FONT_CSS_MAP[id])
            }
          }}
          options={FONT_OPTIONS.map(f => ({
            id: f.id,
            label: f.label,
            desc: FONT_CSS_MAP[f.id].split(',')[0].replace(/'/g, ''),
            // 用该字体本身渲染预览字样，直观展示效果
            icon: <span className="text-[13px]" style={{ fontFamily: FONT_CSS_MAP[f.id] }}>Aa</span>,
            isDefault: f.id === 'system',
          }))}
        />
      </div>

      <div className="mb-8" data-setting-anchor="editor.fontSize">
        <h3 className="text-[12px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-3">字号</h3>
        <div className="flex gap-1.5 max-w-xs">
          {FONT_SIZE_OPTIONS.map(fs => (
            <button
              key={fs.id}
              onClick={() => update('editorFontSize', fs.id)}
              className={`flex-1 px-2 py-2 rounded text-[12px] border transition-colors ${
                s.editorFontSize === fs.id
                  ? 'border-[var(--accent)] bg-[var(--bg-selected)] text-[var(--text-primary)]'
                  : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
              }`}
            >
              {fs.label}
            </button>
          ))}
        </div>
      </div>

      <div data-setting-anchor="editor.lineNumbers">
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
