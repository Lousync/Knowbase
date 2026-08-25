import { createContext, useContext, useState, useEffect } from 'react'
import type { ReactNode } from 'react'
import { usePomodoroState, BASE_PRESETS, type PomodoroState, type PomodoroPresetDef } from './usePomodoroState'
import { getPluginPomodoroPresets } from '../../../lib/pluginService'

type Ctx = ReturnType<typeof usePomodoroState>

const C = createContext<Ctx | null>(null)

export function PomodoroProvider({ children }: { children: ReactNode }) {
  // 内置预设 + 已启用插件贡献的扩展预设(异步加载,加载完成前先用内置)
  const [presets, setPresets] = useState<PomodoroPresetDef[]>(BASE_PRESETS)
  useEffect(() => {
    getPluginPomodoroPresets()
      .then(pluginPresets => { if (pluginPresets.length > 0) setPresets([...BASE_PRESETS, ...pluginPresets]) })
      .catch(() => { /* 忽略,保持内置 */ })
  }, [])
  const pom = usePomodoroState(presets)
  return <C.Provider value={pom}>{children}</C.Provider>
}

export function usePomodoro(): Ctx {
  const ctx = useContext(C)
  if (!ctx) throw new Error('usePomodoro must be inside PomodoroProvider')
  return ctx
}

/** Re-export for convenience */
export type { PomodoroState }
