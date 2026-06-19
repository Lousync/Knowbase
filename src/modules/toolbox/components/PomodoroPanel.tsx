import { Play, Pause, RotateCcw, SkipForward } from 'lucide-react'
import { usePomodoro } from '../hooks/PomodoroContext'

const PRESETS = [
  { label: '25 分钟', work: 25, break: 5 },
  { label: '45 分钟', work: 45, break: 10 },
  { label: '15 分钟', work: 15, break: 3 },
]

export function PomodoroPanel() {
  const pom = usePomodoro()
  const { state: ps } = pom
  if (!ps.visible || !ps.expanded) return null

  const radius = 100
  const circumference = 2 * Math.PI * radius

  return (
    <div className="absolute inset-0 z-30 bg-[var(--bg-primary)] flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-[var(--border-color)] shrink-0">
        <button
          onClick={() => pom.setState(s => ({ ...s, expanded: false }))}
          className="text-[13px] text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors"
        >
          ← 返回
        </button>
        <h2 className="text-[15px] font-medium text-[var(--text-primary)]">🍅 番茄钟</h2>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto flex flex-col items-center justify-center gap-6 pb-8">
        {/* Preset buttons */}
        <div className="flex items-center gap-1 bg-[var(--bg-tertiary)] rounded-md p-0.5">
          {PRESETS.map((p, i) => (
            <button
              key={p.label}
              onClick={() => pom.setPresetIdx(i)}
              className={`px-3 py-1 text-[12px] rounded transition-colors ${
                i === ps.presetIdx
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
          <svg width="220" height="220" className="-rotate-90">
            <circle cx="110" cy="110" r={radius} fill="none" stroke="var(--bg-tertiary)" strokeWidth="8" />
            <circle
              cx="110" cy="110" r={radius}
              fill="none"
              stroke={ps.phase === 'work' ? 'var(--accent)' : 'var(--success)'}
              strokeWidth="8" strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - pom.progress)}
              className="transition-[stroke-dashoffset] duration-1000 ease-linear"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className={`text-[44px] font-mono font-bold tracking-tight ${ps.done ? 'text-[var(--success)]' : 'text-[var(--text-primary)]'}`}>
              {pom.display}
            </span>
            <span className={`text-[13px] font-medium mt-1 ${ps.phase === 'work' ? 'text-[var(--accent)]' : 'text-[var(--success)]'}`}>
              {ps.done ? '时间到！' : ps.phase === 'work' ? '专注中' : '休息中'}
            </span>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2">
          {!ps.running ? (
            <button
              onClick={pom.startTimer}
              disabled={ps.done}
              className="flex items-center gap-1.5 px-5 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-[13px] font-medium rounded-md transition-colors disabled:opacity-40"
            >
              <Play size={15} />
              {ps.done ? '已完成' : '开始'}
            </button>
          ) : (
            <button
              onClick={pom.pauseTimer}
              className="flex items-center gap-1.5 px-5 py-2 bg-[var(--warning)] hover:bg-[#d4b13a] text-[#1e1e1e] text-[13px] font-medium rounded-md transition-colors"
            >
              <Pause size={15} />
              暂停
            </button>
          )}
          <button
            onClick={pom.resetTimer}
            className="flex items-center gap-1 px-3 py-2 text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-color)] rounded-md transition-colors"
          >
            <RotateCcw size={13} />
            重置
          </button>
        </div>

        {/* Switch phase */}
        <button
          onClick={pom.switchPhase}
          className="flex items-center gap-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"
        >
          <SkipForward size={12} />
          切换到{ps.phase === 'work' ? '休息' : '专注'}
        </button>

        {ps.done && (
          <div className="px-4 py-2 bg-[var(--accent)]/10 border border-[var(--accent)]/30 rounded-md text-[13px] text-[var(--accent)] font-medium">
            🎉 {ps.phase === 'work' ? '专注时间结束，休息一下吧！' : '休息结束，开始下一轮专注！'}
          </div>
        )}

        <div className="text-center text-[11px] text-[var(--text-muted)] leading-relaxed">
          专注 {pom.preset.work} 分钟 · 休息 {pom.preset.break} 分钟
          <br />
          点击「← 返回」回到工具画廊，计时继续
        </div>
      </div>
    </div>
  )
}
