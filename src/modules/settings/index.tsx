import { useState, useMemo, useEffect } from 'react'
import { Palette, Type, FileDown, Wrench, Info, Search, Keyboard, Bot } from 'lucide-react'
import { AppearanceView } from './views/AppearanceView'
import { EditorView } from './views/EditorView'
import { ExportSettingsView } from './views/ExportSettingsView'
import { AdvancedView } from './views/AdvancedView'
import { ShortcutsView } from './views/ShortcutsView'
import { AIView } from './views/AIView'

type SettingsSection = 'appearance' | 'editor' | 'export' | 'ai' | 'advanced' | 'shortcuts'

interface SectionDef {
  id: SettingsSection
  label: string
  icon: React.ReactNode
  keywords: string[]
}

const SECTIONS: SectionDef[] = [
  { id: 'appearance', label: '外观',   icon: <Palette size={16} />,  keywords: ['主题', 'theme', '颜色', '字体', '外观', '界面', '深色', '浅色'] },
  { id: 'editor',     label: '编辑器', icon: <Type size={16} />,     keywords: ['字体', '行号', '编辑', '代码', '样式', 'font', '字号'] },
  { id: 'export',     label: '导出',   icon: <FileDown size={16} />, keywords: ['编码', '导出', 'encoding', 'utf', 'gbk', '保存'] },
  { id: 'ai',        label: 'AI 服务', icon: <Bot size={16} />,     keywords: ['ai', 'api', '密钥', '模型', 'deepseek', 'openai', '聊天'] },
  { id: 'advanced',   label: '高级',   icon: <Wrench size={16} />,   keywords: ['缩放', '删除', '确认', '保存', 'zoom', '重置', '自动', '跳过'] },
  { id: 'shortcuts',  label: '快捷键', icon: <Keyboard size={16} />, keywords: ['快捷键', 'shortcut', '键盘', 'keyboard', 'ctrl', 'tab', '删除', '保存', '预览', '重命名', '侧栏', '切换'] },
]

// Module-level target for cross-component navigation (toast "查看详情" etc.)
let pendingSection: SettingsSection | null = null

export function navigateToSettingsSection(section: SettingsSection) {
  pendingSection = section
  window.dispatchEvent(new CustomEvent('settings:open'))
}

export function SettingsModule() {
  const [section, setSection] = useState<SettingsSection>('appearance')
  const [query, setQuery] = useState('')

  // Consume pending section on mount
  useEffect(() => {
    if (pendingSection) {
      setSection(pendingSection)
      pendingSection = null
    }
  }, [])

  const visibleSections = useMemo(() => {
    if (!query.trim()) return null
    const q = query.toLowerCase()
    return SECTIONS.filter(s => {
      if (s.label.includes(q)) return true
      return s.keywords.some(kw => kw.toLowerCase().includes(q))
    })
  }, [query])

  return (
    <div className="flex h-full bg-[var(--bg-primary)]">
      {/* Left nav */}
      <div className="w-48 shrink-0 bg-[var(--bg-secondary)] border-r border-[var(--border-color)] py-4 flex flex-col">
        <div className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wide px-4 mb-1">
          设置
        </div>

        {SECTIONS.map(s => {
          const hidden = visibleSections && !visibleSections.some(vs => vs.id === s.id)
          return (
            <button
              key={s.id}
              onClick={() => { setSection(s.id); setQuery('') }}
              className={`w-full flex items-center gap-2 px-4 py-2 text-[13px] transition-colors ${
                hidden ? 'hidden' : ''
              } ${
                section === s.id
                  ? 'bg-[var(--bg-selected)] text-[var(--text-primary)] border-l-2 border-l-[var(--accent)] pl-[14px]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] border-l-2 border-l-transparent pl-[14px]'
              }`}
            >
              <span className={section === s.id ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}>
                {s.icon}
              </span>
              {s.label}
            </button>
          )
        })}

        <div className="mt-auto pt-2 border-t border-[var(--border-color)] px-4">
          <span className="flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
            <Info size={13} />
            Knowbase v1.3.0
          </span>
        </div>
      </div>

      {/* Right content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Search bar */}
        <div className="px-8 pt-6 pb-2 shrink-0">
          <div className="max-w-2xl mx-auto">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="搜索设置..."
              className="w-full pl-9 pr-4 py-2 bg-[var(--input-bg)] border border-[var(--border-color)] rounded-md text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-disabled)]"
            />
          </div>
          {query.trim() && visibleSections && visibleSections.length === 0 && (
            <p className="text-[12px] text-[var(--text-muted)] mt-3 text-center">
              未找到匹配的设置项
            </p>
          )}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto py-6">
          <div className="max-w-2xl mx-auto px-8">
          {section === 'appearance' && <AppearanceView />}
          {section === 'editor' && <EditorView />}
          {section === 'export' && <ExportSettingsView />}
          {section === 'ai' && <AIView />}
          {section === 'advanced' && <AdvancedView />}
          {section === 'shortcuts' && <ShortcutsView />}
          </div>
        </div>
      </div>
    </div>
  )
}
