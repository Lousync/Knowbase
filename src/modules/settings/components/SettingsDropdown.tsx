import { useState, useEffect } from 'react'
import { Sun, Moon, RotateCcw, Folder } from 'lucide-react'
import { setSetting, getAllSettings, openDirDialog } from '../../../lib/ipc'
import { THEME_OPTIONS, FONT_OPTIONS, FONT_CSS_MAP, ENCODING_OPTIONS } from '../../../lib/settings'
import type { AppSettings } from '../../../lib/settings'

const THEME_ICONS: Record<string, React.ReactNode> = {
  dark:  <Moon size={16} />,
  light: <Sun size={16} />,
}

export function SettingsDropdown() {
  const [loaded, setLoaded] = useState(false)
  const [s, setS] = useState<AppSettings | null>(null)

  useEffect(() => {
    getAllSettings().then(s => { setS(s); setLoaded(true) })
  }, [])

  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    if (!s) return
    setS({ ...s, [key]: value })
    setSetting(key, value)
  }

  if (!loaded) return <div className="w-72 p-4 text-[12px] text-[var(--text-muted)]">加载中...</div>
  if (!s) return <div className="w-72 p-4 text-[12px] text-[var(--text-muted)]">加载失败</div>

  return (
    <div className="w-72 max-h-[500px] overflow-y-auto py-2">
      <div className="px-3 py-1.5 text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">设置</div>

      {/* Theme */}
      <div className="px-3 py-2">
        <div className="text-[10px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-1.5">主题</div>
        <div className="flex gap-1.5">
          {THEME_OPTIONS.map(t => (
            <button key={t.id} onClick={() => {
              update('theme', t.id)
              document.documentElement.classList.toggle('light', t.id === 'light')
            }}
              className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded text-[11px] border transition-colors ${
                s.theme === t.id ? 'border-[var(--accent)] bg-[var(--bg-selected)] text-[var(--text-primary)]' : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
              }`}
            >{THEME_ICONS[t.id]}{t.label}</button>
          ))}
        </div>
      </div>

      {/* Font */}
      <div className="px-3 py-2">
        <div className="text-[10px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-1.5">字体</div>
        <div className="space-y-0.5">
          {FONT_OPTIONS.map(f => (
            <button key={f.id} onClick={() => {
              update('editorFont', f.id)
              document.documentElement.style.setProperty('--font-sans', FONT_CSS_MAP[f.id])
            }}
              className={`w-full text-left px-2 py-1 rounded text-[11px] transition-colors ${
                s.editorFont === f.id ? 'bg-[var(--bg-selected)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
              }`}
            >
              {f.label} <span className="text-[var(--text-muted)] ml-1">({f.sample})</span>
            </button>
          ))}
        </div>
      </div>

      {/* Encoding */}
      <div className="px-3 py-2">
        <div className="text-[10px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-1.5">导出编码</div>
        <div className="space-y-0.5">
          {ENCODING_OPTIONS.map(e => (
            <button key={e.id} onClick={() => {
              update('exportEncoding', e.id)
              window.dispatchEvent(new CustomEvent('settings-encoding-changed', { detail: e.id }))
            }}
              className={`w-full text-left px-2 py-1 rounded text-[11px] transition-colors ${
                s.exportEncoding === e.id ? 'bg-[var(--bg-selected)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
              }`}
            >
              {e.label} <span className="text-[var(--text-muted)] ml-1">({e.desc})</span>
            </button>
          ))}
        </div>
      </div>

      <div className="border-t border-[var(--border-color)] mt-1 pt-1 px-3 py-2 space-y-2">
        {/* Line numbers */}
        <label className="flex items-center justify-between cursor-pointer">
          <span className="text-[11px] text-[var(--text-primary)]">显示行号</span>
          <input type="checkbox" checked={s.showLineNumbers}
            onChange={() => update('showLineNumbers', !s.showLineNumbers)}
            className="accent-[var(--accent)]" />
        </label>

        {/* Zoom */}
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-[var(--text-primary)]">缩放 {Math.round(s.zoom * 100)}%</span>
          <button onClick={() => { update('zoom', 1.0); document.documentElement.style.fontSize = '16px' }}
            className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-[var(--text-secondary)] border border-[var(--border-color)] rounded hover:bg-[var(--bg-hover)] transition-colors">
            <RotateCcw size={10} />重置
          </button>
        </div>

        {/* Skip delete confirm */}
        <label className="flex items-center justify-between cursor-pointer">
          <span className="text-[11px] text-[var(--text-primary)]">跳过博客删除确认</span>
          <input type="checkbox" checked={s.skipDeleteConfirm_blog}
            onChange={() => update('skipDeleteConfirm_blog', !s.skipDeleteConfirm_blog)}
            className="accent-[var(--accent)]" />
        </label>
        <label className="flex items-center justify-between cursor-pointer">
          <span className="text-[11px] text-[var(--text-primary)]">跳过知识库页面删除确认</span>
          <input type="checkbox" checked={s.skipDeleteConfirm_knowledge}
            onChange={() => update('skipDeleteConfirm_knowledge', !s.skipDeleteConfirm_knowledge)}
            className="accent-[var(--accent)]" />
        </label>
        <label className="flex items-center justify-between cursor-pointer">
          <span className="text-[11px] text-[var(--text-primary)]">跳过目录/笔记本删除确认</span>
          <input type="checkbox" checked={s.skipDeleteConfirm_knowledgeCategory}
            onChange={() => update('skipDeleteConfirm_knowledgeCategory', !s.skipDeleteConfirm_knowledgeCategory)}
            className="accent-[var(--accent)]" />
        </label>

        {/* Trash export dir */}
        <div className="pt-1.5 border-t border-[var(--border-color)]">
          <div className="text-[10px] text-[var(--text-secondary)] mb-1">回收站文件导出目录</div>
          <p className="text-[9px] text-[var(--text-disabled)] truncate mb-1">
            {s.trashExportDir || '默认（Documents\\Knowbase\\回收站）'}
          </p>
          <button
            onClick={async () => {
              const dir = await openDirDialog()
              if (dir) update('trashExportDir', dir)
            }}
            className="flex items-center gap-1 px-2 py-1 text-[10px] text-[var(--text-secondary)] border border-[var(--border-color)] rounded hover:bg-[var(--bg-hover)] transition-colors"
          >
            <Folder size={12} />选择目录
          </button>
        </div>
      </div>
    </div>
  )
}
