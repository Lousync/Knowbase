import { useSettings } from '../../../lib/SettingsContext'
import { FONT_OPTIONS, FONT_CSS_MAP } from '../../../lib/settings'
import { SettingSelect } from '../components/SettingSelect'
import { NumberField } from '../components/fields/NumberField'
import { SettingSwitch } from '../components/SettingSwitch'

export function EditorView() {
  const { s, update } = useSettings()

  return (
    <div>
      <h2 className="text-[15px] font-medium text-[var(--text-primary)] mb-1">编辑器</h2>
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
        <NumberField
          value={s.editorFontSize}
          onCommit={(v) => update('editorFontSize', v)}
          min={10}
          max={40}
          step={1}
          unit="px"
          presets={[12, 13, 14, 15, 16, 18, 20]}
          defaultValue={13}
        />
        <p className="text-[11px] text-[var(--text-muted)] mt-1.5 leading-relaxed">
          可直接输入任意字号（10-40px），或点预设档位；输入越界会提示且不生效。
        </p>
      </div>

      <div data-setting-anchor="editor.lineNumbers">
        <h3 className="text-[12px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-3">显示</h3>
        <label className="flex items-center justify-between gap-4 cursor-pointer max-w-md">
          <span className="text-[13px] text-[var(--text-primary)]">显示行号</span>
          <SettingSwitch checked={s.showLineNumbers} onChange={(v) => update('showLineNumbers', v)} />
        </label>
        <div data-setting-anchor="editor.markdownDim" className="mt-2.5">
          <label className="flex items-center justify-between gap-4 cursor-pointer max-w-md">
            <span className="text-[13px] text-[var(--text-primary)]">Markdown 标记淡化（光标行保留原始标记）</span>
            <SettingSwitch checked={s.markdownDim} onChange={(v) => update('markdownDim', v)} />
          </label>
        </div>
        <p className="text-[11px] text-[var(--text-muted)] mt-1.5 leading-relaxed">
          编辑 .md 时光标所在行之外的格式标记（**、#、链接、[[双链]] 等）会淡化显示，
          被包裹的内容以加粗/斜体/链接色呈现——写作时更接近阅读效果。
        </p>
      </div>
    </div>
  )
}
