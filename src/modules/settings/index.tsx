import { useState } from 'react'
import { Palette, Type, FileDown, Wrench } from 'lucide-react'
import { AppearanceView } from './views/AppearanceView'
import { EditorView } from './views/EditorView'
import { ExportSettingsView } from './views/ExportSettingsView'
import { AdvancedView } from './views/AdvancedView'

type SettingsSection = 'appearance' | 'editor' | 'export' | 'advanced'

const SECTIONS: { id: SettingsSection; label: string; icon: React.ReactNode }[] = [
  { id: 'appearance', label: '外观', icon: <Palette size={16} /> },
  { id: 'editor', label: '编辑器', icon: <Type size={16} /> },
  { id: 'export', label: '导出', icon: <FileDown size={16} /> },
  { id: 'advanced', label: '高级', icon: <Wrench size={16} /> },
]

export function SettingsModule() {
  const [section, setSection] = useState<SettingsSection>('appearance')

  return (
    <div className="flex h-full bg-[var(--bg-primary)]">
      {/* Left nav */}
      <div className="w-48 shrink-0 bg-[var(--bg-secondary)] border-r border-[var(--border-color)] py-4">
        <div className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wide px-4 mb-2">
          设置
        </div>
        {SECTIONS.map(s => (
          <button
            key={s.id}
            onClick={() => setSection(s.id)}
            className={`w-full flex items-center gap-2 px-4 py-2 text-[13px] transition-colors ${
              section === s.id
                ? 'bg-[var(--bg-selected)] text-[var(--text-primary)]'
                : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
            }`}
          >
            <span className={section === s.id ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}>
              {s.icon}
            </span>
            {s.label}
          </button>
        ))}
      </div>

      {/* Right content */}
      <div className="flex-1 overflow-y-auto p-8">
        {section === 'appearance' && <AppearanceView />}
        {section === 'editor' && <EditorView />}
        {section === 'export' && <ExportSettingsView />}
        {section === 'advanced' && <AdvancedView />}
      </div>
    </div>
  )
}
