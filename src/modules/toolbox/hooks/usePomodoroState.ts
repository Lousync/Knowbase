import { useState, useRef, useCallback, useEffect } from 'react'

const PRESETS = [
  { label: '25min', work: 25, break: 5 },
  { label: '45min', work: 45, break: 10 },
  { label: '15min', work: 15, break: 3 },
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

export function usePomodoroState() {
  const [state, setState] = useState<PomodoroState>({
    visible: false,
    expanded: false,
    presetIdx: 0,
    phase: 'work',
    seconds: PRESETS[0].work * 60,
    running: false,
    done: false,
  })
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

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
      seconds: PRESETS[s.presetIdx].work * 60,
    }))
  }, [clearTimer])

  const switchPhase = useCallback(() => {
    clearTimer()
    setState(s => {
      const next: Phase = s.phase === 'work' ? 'break' : 'work'
      const preset = PRESETS[s.presetIdx]
      return {
        ...s,
        running: false,
        done: false,
        phase: next,
        seconds: next === 'work' ? preset.work * 60 : preset.break * 60,
      }
    })
  }, [clearTimer])

  const setPresetIdx = useCallback((idx: number) => {
    clearTimer()
    setState(s => ({
      ...s,
      presetIdx: idx,
      phase: 'work',
      seconds: PRESETS[idx].work * 60,
      running: false,
      done: false,
    }))
  }, [clearTimer])

  const activate = useCallback((preset?: number) => {
    clearTimer()
    const idx = preset ?? 0
    setState({
      visible: true,
      expanded: true,
      presetIdx: idx,
      phase: 'work',
      seconds: PRESETS[idx].work * 60,
      running: false,
      done: false,
    })
  }, [clearTimer])

  const hide = useCallback(() => {
    clearTimer()
    setState(s => ({ ...s, visible: false, expanded: false }))
  }, [clearTimer])

  // Cleanup on unmount
  useEffect(() => () => clearTimer(), [clearTimer])

  const preset = PRESETS[state.presetIdx]
  const totalSeconds = state.phase === 'work' ? preset.work * 60 : preset.break * 60
  const progress = totalSeconds > 0 ? 1 - state.seconds / totalSeconds : 0

  const mins = Math.floor(state.seconds / 60)
  const secs = state.seconds % 60
  const display = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`

  return {
    state, setState,
    preset, totalSeconds, progress, display,
    startTimer, pauseTimer, resetTimer, switchPhase, setPresetIdx, activate, hide,
  }
}
