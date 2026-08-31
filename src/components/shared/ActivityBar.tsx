import { useState, useRef, useEffect } from 'react'
import type { TabName } from '../../types'
import { Palette, ChevronRight, ChevronDown, Check, Download, FlaskConical, LifeBuoy } from 'lucide-react'
import { useSettings } from '../../lib/SettingsContext'
import { applyThemeClass } from '../../lib/settings'
import { useContextMenuPosition } from '../../lib/useContextMenuPosition'
import { BlogIcon, ScheduleIcon, KnowledgeIcon, MomentsIcon, ToolboxIcon, RecycleIcon, UserIcon, SettingsIcon, PluginIcon } from './ModuleIcons'

/** All draggable module tabs (excluding user/settings; 帮助已在用户菜单内,侧边栏不再单列) */
const ALL_MODULES: { id: TabName; label: string; icon: (size: number) => React.ReactNode }[] = [
  { id: 'blog',      label: '博客',   icon: s => <BlogIcon size={s} /> },
  { id: 'schedule',  label: '日程',   icon: s => <ScheduleIcon size={s} /> },
  { id: 'knowledge', label: '知识库', icon: s => <KnowledgeIcon size={s} /> },
  { id: 'moments',   label: '说说',   icon: s => <MomentsIcon size={s} /> },
  { id: 'toolbox',   label: '工具箱', icon: s => <ToolboxIcon size={s} /> },
  { id: 'plugins',   label: '插件',   icon: s => <PluginIcon size={s} /> },
  { id: 'recycle',   label: '回收站', icon: s => <RecycleIcon size={s} /> },
]

const THEME_CHOICES = [
  { id: 'dark',  label: '深色主题' },
  { id: 'light', label: '浅色主题' },
]

function safeParse(json: string, fallback: string[]): string[] {
  try { const v = JSON.parse(json); if (Array.isArray(v)) return v } catch {}
  return fallback
}

interface Props {
  active: TabName
  onChange: (tab: TabName) => void
  onToggleSidebar?: () => void
}

export function ActivityBar({ active, onChange, onToggleSidebar }: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [themeExpanded, setThemeExpanded] = useState(false)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)
  const { menuRef: ctxMenuRef, style: ctxMenuStyle } = useContextMenuPosition(ctxMenu)
  const [dragId, setDragId] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const { s, update } = useSettings()

  const allOrder: string[] = safeParse(s.activityBarOrder, ['blog','schedule','knowledge','toolbox','recycle'])
  const hidden: string[] = safeParse(s.activityBarHidden, [])

  // Compute ordered visible modules
  const order = allOrder.filter(id => ALL_MODULES.some(m => m.id === id))
  // Append any new modules not yet in the order
  for (const m of ALL_MODULES) {
    if (!order.includes(m.id)) order.push(m.id)
  }
  const visible = order.filter(id => !hidden.includes(id) && ALL_MODULES.some(m => m.id === id))

  // Dismiss menus on outside click
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  // Dismiss context menu (Escape only — backdrop onClick handles outside clicks)
  useEffect(() => {
    if (!ctxMenu) return
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setCtxMenu(null) }
    document.addEventListener('keydown', onEsc)
    return () => { document.removeEventListener('keydown', onEsc) }
  }, [ctxMenu])

  const handleChooseTheme = (id: string) => {
    update('theme', id)
    applyThemeClass(id)
  }

  const toggleHidden = (id: string) => {
    const next = hidden.includes(id) ? hidden.filter(h => h !== id) : [...hidden, id]
    update('activityBarHidden', JSON.stringify(next))
  }

  // ----- drag reorder (HTML5) -----
  const handleDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
    setDragId(id)
    requestAnimationFrame(() => {
      (e.currentTarget as HTMLElement | null)?.style?.setProperty('opacity', '0.4')
    })
  }

  const handleDragEnd = (e: React.DragEvent) => {
    (e.currentTarget as HTMLElement | null)?.style?.setProperty('opacity', '1')
    setDragId(null)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault()
    const srcId = e.dataTransfer.getData('text/plain')
    if (!srcId || srcId === targetId) return

    const newOrder = [...order]
    const srcIdx = newOrder.indexOf(srcId)
    const dstIdx = newOrder.indexOf(targetId)
    if (srcIdx === -1 || dstIdx === -1) return

    newOrder.splice(srcIdx, 1)
    newOrder.splice(dstIdx, 0, srcId)
    update('activityBarOrder', JSON.stringify(newOrder))
  }

  return (
    <div ref={barRef}
      className="w-14 my-1.5 rounded-xl bg-[var(--activitybar-bg)] border border-[var(--border-color)] shadow-[0_6px_24px_rgba(0,0,0,0.16)] flex flex-col items-center py-2 gap-1 shrink-0 select-none"
      onContextMenu={e => {
        e.preventDefault()
        setCtxMenu({ x: e.clientX, y: e.clientY })
      }}
    >
      {/* Module tabs — draggable */}
      {visible.map(tabId => {
        const mod = ALL_MODULES.find(m => m.id === tabId)!
        const isActive = active === tabId
        return (
          <button
            key={tabId}
            draggable
            onDragStart={e => handleDragStart(e, tabId)}
            onDragEnd={handleDragEnd}
            onDragOver={handleDragOver}
            onDrop={e => handleDrop(e, tabId)}
            onClick={() => {
              if (isActive && onToggleSidebar) onToggleSidebar()
              else onChange(tabId)
            }}
            title={`${mod.label}${dragId && dragId !== tabId ? ' — 拖放到此处排序' : ''}`}
            className={`
              w-14 h-14 flex items-center justify-center relative rounded-2xl transition-all duration-150
              ${isActive
                ? 'text-[var(--accent)] bg-[var(--bg-hover)]/80 shadow-[inset_0_0_0_1px_var(--border-color)]'
                : dragId === tabId
                  ? 'text-[var(--accent)]/50'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]/50'}
            `}
          >
            {isActive && (
              <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-9 bg-[var(--accent)] rounded-r-full" />
            )}
            {mod.icon(26)}
          </button>
        )
      })}

      {/* User button */}
      <div className="mt-auto">
        {/* 开发者工具 — 仅 DEV 渲染,打包构建时该分支被静态消除 */}
        {import.meta.env.DEV && (
          <button
            onClick={() => onChange('devtools')}
            className={`w-14 h-14 flex items-center justify-center relative rounded-2xl transition-all duration-150 ${
              active === 'devtools'
                ? 'text-[var(--accent)] bg-[var(--bg-hover)]/80 shadow-[inset_0_0_0_1px_var(--border-color)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]/50'
            }`}
            title="开发者工具 (DEV)"
          >
            {active === 'devtools' && (
              <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-9 bg-[var(--accent)] rounded-r-full" />
            )}
            <FlaskConical size={26} />
          </button>
        )}
        <button
          onClick={() => onChange('user')}
          className={`w-14 h-14 flex items-center justify-center relative rounded-2xl transition-all duration-150 ${
            active === 'user'
              ? 'text-[var(--accent)] bg-[var(--bg-hover)]/80 shadow-[inset_0_0_0_1px_var(--border-color)]'
              : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]/50'
          }`}
          title="用户"
        >
          {active === 'user' && (
            <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-9 bg-[var(--accent)] rounded-r-full" />
          )}
          <UserIcon size={26} />
        </button>
      </div>

      {/* Settings button + popup menu */}
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => { setMenuOpen(v => !v); setThemeExpanded(false) }}
          className={`w-14 h-14 flex items-center justify-center relative rounded-2xl transition-all duration-150 ${
            active === 'settings' || menuOpen
              ? 'text-[var(--accent)] bg-[var(--bg-hover)]/80 shadow-[inset_0_0_0_1px_var(--border-color)]'
              : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]/50'
          }`}
          title="设置与主题"
        >
          <SettingsIcon size={26} />
        </button>

        {menuOpen && (
          <div className="absolute left-full bottom-0 ml-1 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg shadow-xl z-50 w-44 py-1">
            {/* 主题 */}
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
                  <button key={tc.id} onClick={() => handleChooseTheme(tc.id)}
                    className="w-full flex items-center gap-2 px-5 py-1.5 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors">
                    <span className="w-4 flex items-center justify-center shrink-0">
                      {s.theme === tc.id && <Check size={12} className="text-[var(--accent)]" />}
                    </span>
                    {tc.label}
                  </button>
                ))}
              </div>
            )}

            <div className="border-t border-[var(--border-color)] my-0.5" />

            <button onClick={() => { onChange('settings'); setMenuOpen(false) }}
              className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors">
              <SettingsIcon size={15} className="text-[var(--text-muted)]" />
              设置
            </button>

            <div className="border-t border-[var(--border-color)] my-0.5" />

            {/* 帮助 — 独立整页模块(仅文档侧栏,不嵌设置) */}
            <button onClick={() => { onChange('help'); setMenuOpen(false) }}
              className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors">
              <LifeBuoy size={15} className="text-[var(--text-muted)]" />
              帮助
            </button>

            <div className="border-t border-[var(--border-color)] my-0.5" />

            <button onClick={() => { setMenuOpen(false); window.dispatchEvent(new CustomEvent('open-import-modal')) }}
              className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors">
              <Download size={15} className="text-[var(--text-muted)]" />
              导入数据
            </button>
          </div>
        )}
      </div>

      {/* Right-click context menu — toggle module visibility */}
      {ctxMenu && (
        <div className="fixed inset-0 z-[70]" onClick={() => setCtxMenu(null)}>
          <div
            className="absolute bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg shadow-xl py-0.5 min-w-[180px]"
            ref={ctxMenuRef}
            style={ctxMenuStyle}
            onMouseDown={e => e.stopPropagation()}
            onClick={e => e.stopPropagation()}
          >
            <div className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wide px-3 py-1.5">显示/隐藏模块</div>
            <div className="border-t border-[var(--border-color)]" />
            {ALL_MODULES.map(m => (
              <button
                key={m.id}
                onClick={() => toggleHidden(m.id)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors text-left"
              >
                <span className="w-4 flex items-center justify-center shrink-0">
                  {!hidden.includes(m.id) && <Check size={12} className="text-[var(--accent)]" />}
                </span>
                <span className="flex items-center gap-1.5">
                  {m.icon(14)}
                  {m.label}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
