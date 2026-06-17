import { useState, useEffect } from 'react'
import { Sun, Moon } from 'lucide-react'
import { setSetting, getAllSettings } from '../../../lib/ipc'
import { THEME_OPTIONS } from '../../../lib/settings'
import type { AppSettings } from '../../../lib/settings'

const THEME_ICONS: Record<string, React.ReactNode> = {
  dark:  <Moon size={24} />,
  light: <Sun size={24} />,
}
const THEME_DESCS: Record<string, string> = {
  dark:  'VS Code 风格深色配色，适合夜间使用',
  light: '明亮清爽的浅色配色，适合日间使用',
}

export function AppearanceView() {
  const [s, setS] = useState<AppSettings | null>(null)

  useEffect(() => {
    getAllSettings().then(setS)
  }, [])

  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    if (!s) return
    setS({ ...s, [key]: value })
    setSetting(key, value)
  }

  if (!s) return null

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
                document.documentElement.classList.toggle('light', t.id === 'light')
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
    </div>
  )
}
