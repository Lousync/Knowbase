import { useState, useEffect } from 'react'
import { Sun, Moon, RotateCcw } from 'lucide-react'
import { getSetting, setSetting } from '../../../lib/ipc'

const THEMES = [
  { id: 'dark', label: '深色', icon: <Moon size={16} /> },
  { id: 'light', label: '浅色', icon: <Sun size={16} /> },
]

const FONTS = [
  { id: 'system', label: '系统默认', sample: 'System UI' },
  { id: 'yahei', label: '微软雅黑', sample: 'Microsoft YaHei' },
  { id: 'noto', label: '思源黑体', sample: 'Noto Sans SC' },
  { id: 'mono', label: '等宽字体', sample: 'Cascadia Code' },
]

const ENCODINGS = [
  { id: 'utf-8', label: 'UTF-8', desc: '国际通用' },
  { id: 'gbk', label: 'GBK', desc: 'Windows 默认' },
  { id: 'gb2312', label: 'GB2312', desc: '简体中文' },
]

export function SettingsDropdown() {
  const [loaded, setLoaded] = useState(false)
  const [theme, setTheme] = useState('dark')
  const [font, setFont] = useState('system')
  const [encoding, setEncoding] = useState('utf-8')
  const [showLineNumbers, setShowLineNumbers] = useState(false)
  const [skipDeleteBlog, setSkipDeleteBlog] = useState(false)
  const [skipDeleteKnowledge, setSkipDeleteKnowledge] = useState(false)
  const [zoom, setZoom] = useState(1.0)

  useEffect(() => {
    Promise.all([
      getSetting('theme'), getSetting('editorFont'), getSetting('exportEncoding'),
      getSetting('showLineNumbers'), getSetting('skipDeleteConfirm_blog'),
      getSetting('skipDeleteConfirm_knowledge'), getSetting('zoom'),
    ]).then(([th, fn, enc, ln, skB, skK, z]) => {
      if (typeof th === 'string') setTheme(th)
      if (typeof fn === 'string') setFont(fn)
      if (typeof enc === 'string') setEncoding(enc)
      if (typeof ln === 'boolean') setShowLineNumbers(ln)
      if (typeof skB === 'boolean') setSkipDeleteBlog(skB)
      if (typeof skK === 'boolean') setSkipDeleteKnowledge(skK)
      if (typeof z === 'number') setZoom(z)
      setLoaded(true)
    })
  }, [])

  const fontValues: Record<string, string> = {
    system: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', sans-serif",
    yahei: "'Microsoft YaHei', '微软雅黑', sans-serif",
    noto: "'Source Han Sans SC', 'Noto Sans SC', 'Microsoft YaHei', sans-serif",
    mono: "'Cascadia Code', 'Fira Code', 'Consolas', 'Microsoft YaHei', monospace",
  }

  if (!loaded) return <div className="w-72 p-4 text-[12px] text-[var(--text-muted)]">加载中...</div>

  return (
    <div className="w-72 max-h-[500px] overflow-y-auto py-2">
      <div className="px-3 py-1.5 text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">设置</div>

      {/* Theme */}
      <div className="px-3 py-2">
        <div className="text-[10px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-1.5">主题</div>
        <div className="flex gap-1.5">
          {THEMES.map(t => (
            <button key={t.id} onClick={() => {
              setTheme(t.id); setSetting('theme', t.id)
              document.documentElement.classList.toggle('light', t.id === 'light')
            }}
              className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded text-[11px] border transition-colors ${
                theme === t.id ? 'border-[var(--accent)] bg-[var(--bg-selected)] text-[var(--text-primary)]' : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
              }`}
            >{t.icon}{t.label}</button>
          ))}
        </div>
      </div>

      {/* Font */}
      <div className="px-3 py-2">
        <div className="text-[10px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-1.5">字体</div>
        <div className="space-y-0.5">
          {FONTS.map(f => (
            <button key={f.id} onClick={() => {
              setFont(f.id); setSetting('editorFont', f.id)
              document.documentElement.style.setProperty('--font-sans', fontValues[f.id])
            }}
              className={`w-full text-left px-2 py-1 rounded text-[11px] transition-colors ${
                font === f.id ? 'bg-[var(--bg-selected)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
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
          {ENCODINGS.map(e => (
            <button key={e.id} onClick={() => { setEncoding(e.id); setSetting('exportEncoding', e.id); window.dispatchEvent(new CustomEvent('settings-encoding-changed', { detail: e.id })) }}
              className={`w-full text-left px-2 py-1 rounded text-[11px] transition-colors ${
                encoding === e.id ? 'bg-[var(--bg-selected)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
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
          <input type="checkbox" checked={showLineNumbers}
            onChange={() => { const n = !showLineNumbers; setShowLineNumbers(n); setSetting('showLineNumbers', n) }}
            className="accent-[var(--accent)]" />
        </label>

        {/* Zoom */}
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-[var(--text-primary)]">缩放 {Math.round(zoom * 100)}%</span>
          <button onClick={() => { setZoom(1.0); setSetting('zoom', 1.0); document.documentElement.style.fontSize = '16px' }}
            className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-[var(--text-secondary)] border border-[var(--border-color)] rounded hover:bg-[var(--bg-hover)] transition-colors">
            <RotateCcw size={10} />重置
          </button>
        </div>

        {/* Skip delete confirm */}
        <label className="flex items-center justify-between cursor-pointer">
          <span className="text-[11px] text-[var(--text-primary)]">跳过博客删除确认</span>
          <input type="checkbox" checked={skipDeleteBlog}
            onChange={() => { const n = !skipDeleteBlog; setSkipDeleteBlog(n); setSetting('skipDeleteConfirm_blog', n) }}
            className="accent-[var(--accent)]" />
        </label>
        <label className="flex items-center justify-between cursor-pointer">
          <span className="text-[11px] text-[var(--text-primary)]">跳过知识库删除确认</span>
          <input type="checkbox" checked={skipDeleteKnowledge}
            onChange={() => { const n = !skipDeleteKnowledge; setSkipDeleteKnowledge(n); setSetting('skipDeleteConfirm_knowledge', n) }}
            className="accent-[var(--accent)]" />
        </label>
      </div>
    </div>
  )
}
