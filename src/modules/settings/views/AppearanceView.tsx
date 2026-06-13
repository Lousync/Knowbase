import { useState, useEffect } from 'react'
import { Sun, Moon } from 'lucide-react'
import { getSetting, setSetting } from '../../../lib/ipc'

const THEMES = [
  { id: 'dark', label: '深色主题', icon: <Moon size={24} />, desc: 'VS Code 风格深色配色，适合夜间使用' },
  { id: 'light', label: '浅色主题', icon: <Sun size={24} />, desc: '明亮清爽的浅色配色，适合日间使用' },
]

export function AppearanceView() {
  const [theme, setTheme] = useState('dark')

  useEffect(() => {
    getSetting('theme').then(v => {
      if (typeof v === 'string' && (v === 'dark' || v === 'light')) setTheme(v)
    })
  }, [])

  const handleThemeChange = (id: string) => {
    setTheme(id)
    setSetting('theme', id)
    if (id === 'light') {
      document.documentElement.classList.add('light')
    } else {
      document.documentElement.classList.remove('light')
    }
  }

  return (
    <div>
      <h2 className="text-[16px] font-semibold text-[var(--text-primary)] mb-1">外观</h2>
      <p className="text-[12px] text-[var(--text-muted)] mb-6">自定义应用的外观和主题</p>

      {/* Theme selector */}
      <div className="mb-8">
        <h3 className="text-[12px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-3">主题</h3>
        <div className="grid grid-cols-2 gap-3 max-w-md">
          {THEMES.map(t => (
            <button
              key={t.id}
              onClick={() => handleThemeChange(t.id)}
              className={`flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all ${
                theme === t.id
                  ? 'border-[var(--accent)] bg-[var(--bg-selected)]'
                  : 'border-[var(--border-color)] hover:border-[var(--text-muted)]'
              }`}
            >
              <span className={theme === t.id ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}>
                {t.icon}
              </span>
              <span className={`text-[13px] font-medium ${theme === t.id ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
                {t.label}
              </span>
              <span className="text-[10px] text-[var(--text-muted)] text-center">{t.desc}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
