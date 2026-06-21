import { Sun, Moon, FileText, Calendar, BookOpen, Upload, Trash2, HelpCircle, Wrench } from 'lucide-react'
import { useSettings } from '../../../lib/SettingsContext'
import { THEME_OPTIONS, BLOG_SIZE_OPTIONS, applyThemeClass } from '../../../lib/settings'

const THEME_ICONS: Record<string, React.ReactNode> = {
  dark:  <Moon size={24} />,
  light: <Sun size={24} />,
}
const THEME_DESCS: Record<string, string> = {
  dark:  'VS Code 风格深色配色，适合夜间使用',
  light: '明亮清爽的浅色配色，适合日间使用',
}

export function AppearanceView() {
  const { s, update } = useSettings()

  return (
    <div>
      <h2 className="text-[16px] font-semibold text-[var(--text-primary)] mb-1">外观</h2>
      <p className="text-[12px] text-[var(--text-muted)] mb-6">自定义应用的外观和主题</p>

      <div className="mb-8">
        <h3 className="text-[12px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-3">主题</h3>
        <div className="grid grid-cols-2 gap-3 max-w-md">
          {THEME_OPTIONS.map(t => (
            <button
              key={t.id}
              onClick={() => {
                update('theme', t.id)
                applyThemeClass(t.id)
              }}
              className={`flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all ${
                s.theme === t.id
                  ? 'border-[var(--accent)] bg-[var(--bg-selected)]'
                  : 'border-[var(--border-color)] hover:border-[var(--text-muted)]'
              }`}
            >
              <span className={s.theme === t.id ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}>
                {THEME_ICONS[t.id]}
              </span>
              <span className={`text-[13px] font-medium ${s.theme === t.id ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
                {t.label}
              </span>
              <span className="text-[10px] text-[var(--text-muted)] text-center">{THEME_DESCS[t.id]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="mb-8">
        <h3 className="text-[12px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-3">启动时默认显示</h3>
        <p className="text-[11px] text-[var(--text-muted)] mb-3">每次打开应用时，自动切换到该模块。若该模块被隐藏，则回退到第一个可见模块。</p>
        <div className="grid grid-cols-3 gap-2 max-w-sm">
          {(function () {
            const TABS: { id: string; label: string; icon: React.ReactNode }[] = [
              { id: 'blog', label: '博客', icon: <FileText size={16} /> },
              { id: 'schedule', label: '日程', icon: <Calendar size={16} /> },
              { id: 'knowledge', label: '知识库', icon: <BookOpen size={16} /> },
              { id: 'toolbox', label: '工具箱', icon: <Wrench size={16} /> },
              { id: 'export', label: '导出', icon: <Upload size={16} /> },
              { id: 'recycle', label: '回收站', icon: <Trash2 size={16} /> },
              { id: 'help', label: '帮助', icon: <HelpCircle size={16} /> },
            ]
            return TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => update('startupTab', tab.id)}
                className={`flex items-center gap-1.5 px-2.5 py-2 rounded text-[12px] border transition-colors ${
                  s.startupTab === tab.id
                    ? 'border-[var(--accent)] bg-[var(--bg-selected)] text-[var(--text-primary)]'
                    : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                }`}
              >
                <span className={s.startupTab === tab.id ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}>
                  {tab.icon}
                </span>
                {tab.label}
              </button>
            ))
          })()}
        </div>
      </div>

      <div className="mb-8">
        <h3 className="text-[12px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-3">博客卡片大小</h3>
        <div className="flex gap-1.5 max-w-xs">
          {BLOG_SIZE_OPTIONS.map(bs => (
            <button
              key={bs.id}
              onClick={() => update('blogCardSize', bs.id)}
              className={`flex-1 px-2 py-2 rounded text-[12px] border transition-colors ${
                s.blogCardSize === bs.id
                  ? 'border-[var(--accent)] bg-[var(--bg-selected)] text-[var(--text-primary)]'
                  : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
              }`}
            >
              {bs.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
