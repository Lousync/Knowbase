import { useState, useEffect, useRef } from 'react'
import { usePomodoroState } from '../../modules/toolbox/hooks/usePomodoroState'
import { Play, Pause, RotateCcw, SkipForward, Timer, X } from 'lucide-react'

const PRESETS = [
  { label: '25min', work: 25, break: 5 },
  { label: '45min', work: 45, break: 10 },
  { label: '15min', work: 15, break: 3 },
]

interface StatusBarProps {
  date?: string
  fileType?: string
  encoding?: string
}

export function StatusBar({
  date = '',
  fileType: initialFileType = 'Markdown',
  encoding = 'UTF-8'
}: StatusBarProps) {
  const today = date || new Date().toISOString().split('T')[0]
  const [currentFileType, setCurrentFileType] = useState(initialFileType)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (typeof detail === 'string') setCurrentFileType(detail)
    }
    window.addEventListener('status-filetype', handler)
    const resetHandler = () => setCurrentFileType('Markdown')
    window.addEventListener('tab-switched', resetHandler)
    return () => {
      window.removeEventListener('status-filetype', handler)
      window.removeEventListener('tab-switched', resetHandler)
    }
  }, [])

  // ---- Pomodoro state ----
  const pom = usePomodoroState()
  const { state: ps } = pom

  // Listen for activate event from toolbox
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { preset?: number } | undefined
      pom.activate(detail?.preset)
    }
    window.addEventListener('pomodoro:activate', handler)
    return () => window.removeEventListener('pomodoro:activate', handler)
  }, [pom])

  // Close panel on outside click
  useEffect(() => {
    if (!ps.expanded) return
    const onClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        pom.setState(s => ({ ...s, expanded: false }))
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [ps.expanded, pom])

  // Circular progress params
  const radius = 52
  const circumference = 2 * Math.PI * radius

  return (
    <div className="flex items-center justify-between h-6 bg-[#0e639c] text-white text-[12px] select-none shrink-0 px-1 relative">
      <div className="flex items-center gap-0">
        <StatusItem>📅 {today}</StatusItem>
      </div>
      <div className="flex items-center gap-0">
        {/* Pomodoro pill */}
        {ps.visible && (
          <button
            onClick={() => pom.setState(s => ({ ...s, expanded: !s.expanded }))}
            className={`h-full flex items-center gap-1.5 px-2 hover:bg-[#ffffff20] transition-colors cursor-pointer text-[11px] font-medium ${
              ps.expanded ? 'bg-[#ffffff20]' : ''
            }`}
            title="番茄钟"
          >
            <Timer size={12} />
            <span className="font-mono">{pom.display}</span>
            <span className="opacity-80">
              {ps.done ? '✓' : ps.running ? (ps.phase === 'work' ? '专注中' : '休息中') : '已暂停'}
            </span>
          </button>
        )}
        <StatusItem>{currentFileType}</StatusItem>
        <StatusItem>{encoding}</StatusItem>
      </div>

      {/* Dropdown panel */}
      {ps.expanded && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => pom.setState(s => ({ ...s, expanded: false }))} />
          <div
            ref={panelRef}
            className="absolute bottom-full right-1 mb-1 z-50 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl shadow-2xl p-4 w-[210px] select-none"
          >
            {/* Preset tabs + close */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-0.5 bg-[var(--bg-tertiary)] rounded p-0.5">
                {PRESETS.map((p, i) => (
                  <button
                    key={p.label}
                    onClick={() => pom.setPresetIdx(i)}
                    className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${
                      i === ps.presetIdx ? 'bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <button
                onClick={() => pom.hide()}
                className="p-0.5 text-[var(--text-muted)] hover:text-[var(--danger)] transition-colors rounded"
              >
                <X size={14} />
              </button>
            </div>

            {/* Circular timer */}
            <div className="relative mx-auto mb-3" style={{ width: 124, height: 124 }}>
              <svg width="124" height="124" className="-rotate-90">
                <circle cx="62" cy="62" r={radius} fill="none" stroke="var(--bg-tertiary)" strokeWidth="5" />
                <circle
                  cx="62" cy="62" r={radius}
                  fill="none"
                  stroke={ps.phase === 'work' ? 'var(--accent)' : 'var(--success)'}
                  strokeWidth="5" strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={circumference * (1 - pom.progress)}
                  className="transition-[stroke-dashoffset] duration-1000 ease-linear"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className={`text-[26px] font-mono font-bold tracking-tight ${ps.done ? 'text-[var(--success)]' : 'text-[var(--text-primary)]'}`}>
                  {pom.display}
                </span>
                <span className={`text-[10px] font-medium mt-0.5 ${ps.phase === 'work' ? 'text-[var(--accent)]' : 'text-[var(--success)]'}`}>
                  {ps.done ? '✓ 完成' : ps.phase === 'work' ? '专注中' : '休息中'}
                </span>
              </div>
            </div>

            {/* Controls */}
            <div className="flex items-center justify-center gap-1.5">
              {!ps.running ? (
                <button
                  onClick={pom.startTimer}
                  disabled={ps.done}
                  className="flex items-center gap-1 px-3 py-1 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-[11px] font-medium rounded-md transition-colors disabled:opacity-40"
                >
                  <Play size={12} />
                  {ps.done ? '完成' : '开始'}
                </button>
              ) : (
                <button
                  onClick={pom.pauseTimer}
                  className="flex items-center gap-1 px-3 py-1 bg-[var(--warning)] hover:bg-[#d4b13a] text-[#1e1e1e] text-[11px] font-medium rounded-md transition-colors"
                >
                  <Pause size={12} />
                  暂停
                </button>
              )}
              <button
                onClick={pom.resetTimer}
                className="p-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-color)] rounded-md transition-colors"
              >
                <RotateCcw size={12} />
              </button>
            </div>

            {/* Switch phase */}
            <button
              onClick={pom.switchPhase}
              className="flex items-center gap-1 mx-auto mt-2.5 text-[10px] text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"
            >
              <SkipForward size={10} />
              切换到{ps.phase === 'work' ? '休息' : '专注'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function StatusItem({ children }: { children: React.ReactNode }) {
  return (
    <span className="px-2 h-full flex items-center hover:bg-[#ffffff20] cursor-default transition-colors">
      {children}
    </span>
  )
}
