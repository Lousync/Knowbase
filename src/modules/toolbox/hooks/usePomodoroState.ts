import { useState, useRef, useCallback, useEffect } from 'react'
import { createPomodoroSession } from '../../../lib/ipc'

export interface PomodoroPresetDef { label: string; work: number; break: number }

export const BASE_PRESETS: PomodoroPresetDef[] = [
  { label: '15min', work: 15, break: 3 },
  { label: '25min', work: 25, break: 5 },
  { label: '45min', work: 45, break: 10 },
]

export type Phase = 'work' | 'break'

export interface PomodoroState {
  visible: boolean
  expanded: boolean
  presetIdx: number
  phase: Phase
  seconds: number
  running: boolean
  done: boolean
}

/** presets 可传入插件贡献的扩展预设(合并到内置之后),计时数学全部基于传入列表 */
export function usePomodoroState(presets: PomodoroPresetDef[] = BASE_PRESETS) {
  const [state, setState] = useState<PomodoroState>({
    visible: false,
    expanded: false,
    presetIdx: 0,
    phase: 'work',
    seconds: presets[0].work * 60,
    running: false,
    done: false,
  })
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const presetAt = useCallback((idx: number) => presets[Math.min(Math.max(idx, 0), presets.length - 1)] ?? presets[0], [presets])

  const clearTimer = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
  }, [])

  const startTimer = useCallback(() => {
    clearTimer()
    setState(s => ({ ...s, done: false, running: true }))
    intervalRef.current = setInterval(() => {
      setState(s => {
        if (s.seconds <= 1) {
          clearTimer()
          return { ...s, seconds: 0, running: false, done: true, expanded: true }
        }
        return { ...s, seconds: s.seconds - 1 }
      })
    }, 1000)
  }, [clearTimer])

  const pauseTimer = useCallback(() => {
    clearTimer()
    setState(s => ({ ...s, running: false }))
  }, [clearTimer])

  const resetTimer = useCallback(() => {
    clearTimer()
    setState(s => ({
      ...s,
      running: false,
      done: false,
      phase: 'work',
      seconds: presetAt(s.presetIdx).work * 60,
    }))
  }, [clearTimer, presetAt])

  const switchPhase = useCallback(() => {
    clearTimer()
    setState(s => {
      const next: Phase = s.phase === 'work' ? 'break' : 'work'
      const preset = presetAt(s.presetIdx)
      return {
        ...s,
        running: false,
        done: false,
        phase: next,
        seconds: next === 'work' ? preset.work * 60 : preset.break * 60,
      }
    })
  }, [clearTimer, presetAt])

  const setPresetIdx = useCallback((idx: number) => {
    clearTimer()
    setState(s => ({
      ...s,
      presetIdx: idx,
      phase: 'work',
      seconds: presetAt(idx).work * 60,
      running: false,
      done: false,
    }))
  }, [clearTimer, presetAt])

  const activate = useCallback((preset?: number) => {
    clearTimer()
    const idx = preset ?? 0
    setState({
      visible: true,
      expanded: true,
      presetIdx: idx,
      phase: 'work',
      seconds: presetAt(idx).work * 60,
      running: false,
      done: false,
    })
  }, [clearTimer, presetAt])

  const hide = useCallback(() => {
    clearTimer()
    setState(s => ({ ...s, visible: false, expanded: false }))
  }, [clearTimer])

  // Cleanup on unmount
  useEffect(() => () => clearTimer(), [clearTimer])

  // 专注阶段自然完成 → 落库一次番茄钟记录（每次完成只报一次）
  const reportedRef = useRef(false)
  useEffect(() => {
    if (state.done && state.phase === 'work') {
      if (reportedRef.current) return
      reportedRef.current = true
      void createPomodoroSession(presetAt(state.presetIdx).work).catch(() => { /* 静默失败 */ })
    }
    if (!state.done) reportedRef.current = false
  }, [state.done, state.phase, state.presetIdx, presetAt])

  const preset = presetAt(state.presetIdx)
  const totalSeconds = state.phase === 'work' ? preset.work * 60 : preset.break * 60
  const progress = totalSeconds > 0 ? 1 - state.seconds / totalSeconds : 0

  const mins = Math.floor(state.seconds / 60)
  const secs = state.seconds % 60
  const display = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`

  return {
    state, setState,
    presets, preset, totalSeconds, progress, display,
    startTimer, pauseTimer, resetTimer, switchPhase, setPresetIdx, activate, hide,
  }
}
