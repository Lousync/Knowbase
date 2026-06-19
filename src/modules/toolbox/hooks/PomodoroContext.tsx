import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import { usePomodoroState, type PomodoroState } from './usePomodoroState'

type Ctx = ReturnType<typeof usePomodoroState>

const C = createContext<Ctx | null>(null)

export function PomodoroProvider({ children }: { children: ReactNode }) {
  const pom = usePomodoroState()
  return <C.Provider value={pom}>{children}</C.Provider>
}

export function usePomodoro(): Ctx {
  const ctx = useContext(C)
  if (!ctx) throw new Error('usePomodoro must be inside PomodoroProvider')
  return ctx
}

/** Re-export for convenience */
export type { PomodoroState }
