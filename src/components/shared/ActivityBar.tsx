import { useState, useRef, useEffect } from 'react'
import type { TabName } from '../../types'
import { FileText, Calendar, BookOpen, Upload, Trash2, Download, Settings, Palette, ChevronRight, ChevronDown, Check, HelpCircle, User, Wrench } from 'lucide-react'
import { useSettings } from '../../lib/SettingsContext'
import { applyThemeClass } from '../../lib/settings'

const tabs: { id: TabName; label: string; icon: React.ReactNode }[] = [
  { id: 'blog', label: '博客', icon: <FileText size={28} strokeWidth={1.5} /> },
  { id: 'schedule', label: '日程', icon: <Calendar size={28} strokeWidth={1.5} /> },
  { id: 'knowledge', label: '知识库', icon: <BookOpen size={28} strokeWidth={1.5} /> },
  { id: 'toolbox', label: '工具箱', icon: <Wrench size={28} strokeWidth={1.5} /> },
  { id: 'export', label: '导出', icon: <Upload size={28} strokeWidth={1.5} /> },
  { id: 'recycle', label: '回收站', icon: <Trash2 size={28} strokeWidth={1.5} /> },
]

const THEME_CHOICES = [
  { id: 'dark',  label: '深色主题' },
  { id: 'light', label: '浅色主题' },
]

interface Props {
  active: TabName
  onChange: (tab: TabName) => void
  onToggleSidebar?: () => void
}

export function ActivityBar({ active, onChange, onToggleSidebar }: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [themeExpanded, setThemeExpanded] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const { s, update } = useSettings()

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const handleChooseTheme = (id: string) => {
    update('theme', id)
    applyThemeClass(id)
  }

  return (
    <div className="w-14 bg-[var(--activitybar-bg)] border-r border-[var(--border-color)] flex flex-col items-center py-2 gap-1 shrink-0 select-none">
      {/* 模块 Tab 按钮 */}
      {tabs.map(tab => {
        const isActive = active === tab.id
        return (
          <button
            key={tab.id}
            onClick={() => {
              if (isActive && onToggleSidebar) {
                onToggleSidebar()
              } else {
                onChange(tab.id)
              }
            }}
            title={tab.label}
            className={`
              w-14 h-14 flex items-center justify-center relative transition-colors
              ${isActive ? 'text-[var(--accent)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}
            `}
          >
            {isActive && (
              <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-8 bg-[var(--accent)] rounded-r" />
            )}
            {tab.icon}
          </button>
        )
      })}

      {/* 用户按钮 */}
      <div className="mt-auto">
        <button
          onClick={() => onChange('user')}
          className={`w-14 h-14 flex items-center justify-center relative transition-colors ${
            active === 'user' ? 'text-[var(--accent)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
          }`}
          title="用户"
        >
          {active === 'user' && (
            <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-8 bg-[var(--accent)] rounded-r" />
          )}
          <User size={28} strokeWidth={1.5} />
        </button>
      </div>

      {/* 设置按钮 + 弹出菜单 */}
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => { setMenuOpen(v => !v); setThemeExpanded(false) }}
          className={`w-14 h-14 flex items-center justify-center relative transition-colors ${
            active === 'settings' ? 'text-[var(--accent)]' : menuOpen ? 'text-[var(--accent)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
          }`}
          title="设置与主题"
        >
          <Settings size={28} strokeWidth={1.5} />
        </button>

        {menuOpen && (
          <div className="absolute left-full bottom-0 ml-1 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg shadow-xl z-50 w-44 py-1">
            {/* 主题 — expandable */}
            <button
              onClick={() => setThemeExpanded(v => !v)}
              className="w-full flex items-center justify-between px-3 py-2 text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
            >
              <span className="flex items-center gap-2">
                <Palette size={15} className="text-[var(--text-muted)]" />
                主题
              </span>
              {themeExpanded ? <ChevronDown size={13} className="text-[var(--text-muted)]" /> : <ChevronRight size={13} className="text-[var(--text-muted)]" />}
            </button>

            {themeExpanded && (
              <div className="border-t border-[var(--bg-tertiary)]">
                {THEME_CHOICES.map(tc => (
                  <button
                    key={tc.id}
                    onClick={() => handleChooseTheme(tc.id)}
                    className="w-full flex items-center gap-2 px-5 py-1.5 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
                  >
                    <span className="w-4 flex items-center justify-center shrink-0">
                      {s.theme === tc.id && <Check size={12} className="text-[var(--accent)]" />}
                    </span>
                    {tc.label}
                  </button>
                ))}
              </div>
            )}

            <div className="border-t border-[var(--border-color)] my-0.5" />

            {/* 设置 — navigate */}
            <button
              onClick={() => { onChange('settings'); setMenuOpen(false) }}
              className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
            >
              <Settings size={15} className="text-[var(--text-muted)]" />
              设置
            </button>

            {/* 帮助 — navigate to help tab */}
            <button
              onClick={() => { onChange('help'); setMenuOpen(false) }}
              className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
            >
              <HelpCircle size={15} className="text-[var(--text-muted)]" />
              帮助
            </button>

            <div className="border-t border-[var(--border-color)] my-0.5" />

            {/* 导入 — open modal */}
            <button
              onClick={() => { setMenuOpen(false); window.dispatchEvent(new CustomEvent('open-import-modal')) }}
              className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
            >
              <Download size={15} className="text-[var(--text-muted)]" />
              导入数据
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
