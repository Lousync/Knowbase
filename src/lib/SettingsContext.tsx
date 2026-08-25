import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import type { AppSettings, SettingsKey } from './settings'
import { SETTINGS_DEFAULTS } from './settings'
import { getAllSettings, setSetting } from './ipc'

interface SettingsCtx {
  s: AppSettings
  /** 真实设置是否已从主进程加载完成(默认值 ≠ 加载完成,依赖 s 做一次性判断的逻辑必须等它) */
  ready: boolean
  update: <K extends SettingsKey>(key: K, value: AppSettings[K]) => void
}

const Ctx = createContext<SettingsCtx | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [s, setS] = useState<AppSettings>(SETTINGS_DEFAULTS)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    getAllSettings().then(v => { setS(v); setReady(true) })
  }, [])

  // Listen for settings refresh from import
  useEffect(() => {
    const handler = () => { getAllSettings().then(setS) }
    window.addEventListener('settings-imported', handler)
    return () => window.removeEventListener('settings-imported', handler)
  }, [])

  const update = useCallback(<K extends SettingsKey>(key: K, value: AppSettings[K]) => {
    setS(prev => ({ ...prev, [key]: value }))
    setSetting(key, value)
  }, [])

  return <Ctx.Provider value={{ s, ready, update }}>{children}</Ctx.Provider>
}

export function useSettings(): SettingsCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider')
  return ctx
}
