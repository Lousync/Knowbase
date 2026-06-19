import { useState, useEffect, useRef, useCallback } from 'react'
import { Play, Pause, RotateCcw, SkipForward } from 'lucide-react'

const PRESETS = [
  { label: '25 分钟', work: 25, break: 5 },
  { label: '45 分钟', work: 45, break: 10 },
  { label: '15 分钟', work: 15, break: 3 },
]

type Phase = 'work' | 'break'

interface Props {
  onBack: () => void
}

export function PomodoroTimer({ onBack }: Props) {
  const [presetIdx, setPresetIdx] = useState(0)
  const preset = PRESETS[presetIdx]
  const [phase, setPhase] = useState<Phase>('work')
  const [seconds, setSeconds] = useState(preset.work * 60)
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const totalSeconds = phase === 'work' ? preset.work * 60 : preset.break * 60
  const progress = totalSeconds > 0 ? 1 - seconds / totalSeconds : 0

  const clearTimer = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
  }, [])

  const startTimer = useCallback(() => {
    clearTimer()
    setDone(false)
    setRunning(true)
    intervalRef.current = setInterval(() => {
      setSeconds(s => {
        if (s <= 1) {
          clearTimer()
          setRunning(false)
          setDone(true)
          return 0
        }
        return s - 1
      })
    }, 1000)
  }, [clearTimer])

  const pauseTimer = () => {
    clearTimer()
    setRunning(false)
  }

  const resetTimer = () => {
    clearTimer()
    setRunning(false)
    setDone(false)
    setSeconds(preset.work * 60)
    setPhase('work')
  }

  const switchPhase = () => {
    clearTimer()
    setRunning(false)
    setDone(false)
    const next: Phase = phase === 'work' ? 'break' : 'work'
    setPhase(next)
    setSeconds(next === 'work' ? preset.work * 60 : preset.break * 60)
  }

  // Reset when preset changes
  useEffect(() => {
    clearTimer()
    setRunning(false)
    setDone(false)
    setPhase('work')
    setSeconds(preset.work * 60)
  }, [presetIdx])

  // Cleanup on unmount
  useEffect(() => () => clearTimer(), [clearTimer])

  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  const display = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`

  // Circular progress params
  const radius = 88
  const circumference = 2 * Math.PI * radius
  const dashOffset = circumference * (1 - progress)

  return (
    <div className="flex flex-col h-full bg-[var(--bg-primary)]">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-[var(--border-color)] shrink-0">
        <button onClick={onBack} className="text-[13px] text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors">
          ← 返回
        </button>
        <h2 className="text-[15px] font-medium text-[var(--text-primary)]">🍅 番茄钟</h2>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto flex flex-col items-center justify-center gap-6 pb-8">
        {/* Preset buttons */}
        <div className="flex items-center gap-1 bg-[var(--bg-tertiary)] rounded-md p-0.5">
          {PRESETS.map((p, i) => (
            <button
              key={p.label}
              onClick={() => setPresetIdx(i)}
              className={`px-3 py-1 text-[12px] rounded transition-colors ${
                i === presetIdx
                  ? 'bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-sm'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Circular timer */}
        <div className="relative">
          <svg width="200" height="200" className="-rotate-90">
            {/* Background circle */}
            <circle
              cx="100" cy="100" r={radius}
              fill="none"
              stroke="var(--bg-tertiary)"
              strokeWidth="6"
            />
            {/* Progress circle */}
            <circle
              cx="100" cy="100" r={radius}
              fill="none"
              stroke={phase === 'work' ? 'var(--accent)' : 'var(--success)'}
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              className="transition-[stroke-dashoffset] duration-1000 ease-linear"
            />
          </svg>
          {/* Center text */}
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className={`text-[42px] font-mono font-bold tracking-tight ${done ? 'text-[var(--success)]' : 'text-[var(--text-primary)]'}`}>
              {display}
            </span>
            <span className={`text-[12px] font-medium mt-0.5 ${phase === 'work' ? 'text-[var(--accent)]' : 'text-[var(--success)]'}`}>
              {done ? '时间到！' : phase === 'work' ? '专注中' : '休息中'}
            </span>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2">
          {!running ? (
            <button
              onClick={startTimer}
              disabled={done}
              className="flex items-center gap-1.5 px-5 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-[13px] font-medium rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Play size={15} />
              {done ? '已完成' : '开始'}
            </button>
          ) : (
            <button
              onClick={pauseTimer}
              className="flex items-center gap-1.5 px-5 py-2 bg-[var(--warning)] hover:bg-[#d4b13a] text-[#1e1e1e] text-[13px] font-medium rounded-md transition-colors"
            >
              <Pause size={15} />
              暂停
            </button>
          )}

          <button
            onClick={resetTimer}
            className="flex items-center gap-1 px-3 py-2 text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-color)] rounded-md transition-colors"
          >
            <RotateCcw size={13} />
            重置
          </button>
        </div>

        {/* Skip / Switch phase */}
        <button
          onClick={switchPhase}
          className="flex items-center gap-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"
        >
          <SkipForward size={12} />
          切换到{phase === 'work' ? '休息' : '专注'}
        </button>

        {/* Done banner */}
        {done && (
          <div className="px-4 py-2 bg-[var(--accent)]/10 border border-[var(--accent)]/30 rounded-md text-[13px] text-[var(--accent)] font-medium">
            🎉 {phase === 'work' ? '专注时间结束，休息一下吧！' : '休息结束，开始下一轮专注！'}
          </div>
        )}

        {/* Stats hint */}
        <div className="text-center text-[11px] text-[var(--text-muted)] leading-relaxed">
          专注 {preset.work} 分钟 · 休息 {preset.break} 分钟
          <br />
          工作完成后自动提示
        </div>
      </div>
    </div>
  )
}
