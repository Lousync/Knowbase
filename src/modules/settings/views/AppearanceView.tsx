import { useEffect, useState } from 'react'
import { Sun, Moon, Puzzle, CheckCircle2, ChevronRight } from 'lucide-react'
import { useSettings } from '../../../lib/SettingsContext'
import { THEME_OPTIONS, BLOG_SIZE_OPTIONS, applyThemeClass } from '../../../lib/settings'
import { BlogIcon, ScheduleIcon, KnowledgeIcon, MomentsIcon, ToolboxIcon, IconPreview } from '../../../components/shared/ModuleIcons'
import { ensurePluginThemeStyles, type PluginThemeWithVars } from '../../../lib/pluginService'
import { BUILTIN_ICON_PACKS, usePluginIconPacks, type IconModuleId } from '../../../lib/sidebarIcons'

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
  const [pluginThemes, setPluginThemes] = useState<PluginThemeWithVars[]>([])
  const [themeListOpen, setThemeListOpen] = useState(true)
  const pluginIconPacks = usePluginIconPacks()

  const iconPacks = [
    ...BUILTIN_ICON_PACKS.map(p => ({ id: p.id, label: p.label, desc: '' })),
    ...pluginIconPacks.map(p => ({ id: p.id, label: p.label, desc: `来自插件「${p.pluginName}」` })),
  ]
  // 预览用的模块抽样
  const PREVIEW_MODULES: IconModuleId[] = ['blog', 'schedule', 'knowledge', 'toolbox', 'moments']

  useEffect(() => {
    ensurePluginThemeStyles().then(setPluginThemes).catch(() => {})
    // 插件模块安装/启禁/卸载主题插件后同步刷新
    const refresh = () => { ensurePluginThemeStyles().then(setPluginThemes).catch(() => {}) }
    window.addEventListener('plugins-changed', refresh)
    return () => window.removeEventListener('plugins-changed', refresh)
  }, [])

  const allThemes: { id: string; label: string; desc: string; icon: React.ReactNode }[] = [
    ...THEME_OPTIONS.map(t => ({ id: t.id, label: t.label, desc: THEME_DESCS[t.id] || '', icon: THEME_ICONS[t.id] || <Sun size={24} /> })),
    ...pluginThemes.map(t => ({ id: t.id, label: t.name, desc: `来自插件「${t.pluginName}」`, icon: <Puzzle size={24} /> })),
  ]

  return (
    <div>
      <h2 className="text-[16px] font-semibold text-[var(--text-primary)] mb-1">外观</h2>
      <p className="text-[12px] text-[var(--text-muted)] mb-6">自定义应用的外观和主题</p>

      <div className="mb-8">
        <button
          onClick={() => setThemeListOpen(v => !v)}
          className="w-full flex items-center gap-1.5 mb-3 group"
        >
          <ChevronRight size={12} className={`text-[var(--text-muted)] transition-transform ${themeListOpen ? 'rotate-90' : ''}`} />
          <h3 className="text-[12px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide group-hover:text-[var(--text-primary)]">主题</h3>
          <span className="text-[10px] text-[var(--text-disabled)]">({allThemes.length})</span>
        </button>
        {themeListOpen && (
          <div className="space-y-1.5 max-w-md">
            {allThemes.map(t => (
            <button
              key={t.id}
              onClick={() => {
                update('theme', t.id)
                applyThemeClass(t.id)
              }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-all ${
                s.theme === t.id
                  ? 'border-[var(--accent)] bg-[var(--bg-selected)]'
                  : 'border-[var(--border-color)] hover:bg-[var(--bg-hover)]'
              }`}
            >
              <span className={`shrink-0 ${s.theme === t.id ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}`}>
                {t.icon}
              </span>
              <span className="flex-1 min-w-0">
                <span className={`block text-[13px] font-medium truncate ${s.theme === t.id ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
                  {t.label}
                </span>
                <span className="block text-[11px] text-[var(--text-muted)] truncate">{t.desc}</span>
              </span>
              {s.theme === t.id && <CheckCircle2 size={15} className="text-[var(--accent)] shrink-0" />}
            </button>
          ))}
        </div>
      )}
      </div>

      {/* 侧边栏图标风格(插件可通过 sidebarIcons 贡献追加,新包自动出现在列表末尾) */}
      <div className="mb-8">
        <h3 className="text-[12px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-3">侧边栏图标</h3>
        <p className="text-[11px] text-[var(--text-muted)] mb-3">活动栏模块图标风格;安装带图标包的插件后会自动追加到列表末尾。</p>
        <div className="space-y-1.5 max-w-md">
          {iconPacks.map(pack => (
            <button
              key={pack.id}
              onClick={() => update('sidebarIconStyle', pack.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-all ${
                s.sidebarIconStyle === pack.id
                  ? 'border-[var(--accent)] bg-[var(--bg-selected)]'
                  : 'border-[var(--border-color)] hover:bg-[var(--bg-hover)]'
              }`}
            >
              <span className="flex items-center gap-2.5 shrink-0 text-[var(--text-muted)]">
                {PREVIEW_MODULES.map(m => (
                  <IconPreview key={m} moduleId={m} packId={pack.id} size={20} />
                ))}
              </span>
              <span className="flex-1 min-w-0">
                <span className={`block text-[13px] font-medium truncate ${s.sidebarIconStyle === pack.id ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
                  {pack.label}
                </span>
                {pack.desc && <span className="block text-[11px] text-[var(--text-muted)] truncate">{pack.desc}</span>}
              </span>
              {s.sidebarIconStyle === pack.id && <CheckCircle2 size={15} className="text-[var(--accent)] shrink-0" />}
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
              { id: 'blog', label: '博客', icon: <BlogIcon size={16} /> },
              { id: 'schedule', label: '日程', icon: <ScheduleIcon size={16} /> },
              { id: 'knowledge', label: '知识库', icon: <KnowledgeIcon size={16} /> },
              { id: 'moments', label: '说说', icon: <MomentsIcon size={16} /> },
              { id: 'toolbox', label: '工具箱', icon: <ToolboxIcon size={16} /> },
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
