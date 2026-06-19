import { useState, useEffect } from 'react'
import { Timer } from 'lucide-react'
import { usePomodoro } from '../../modules/toolbox/hooks/PomodoroContext'

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

  // ---- Pomodoro from shared context ----
  const pom = usePomodoro()
  const { state: ps } = pom

  // Listen for activate event from toolbox
  useEffect(() => {
    const handler = (e: Event) => {
      if (pom.state.visible) {
        // Already active — just expand, don't reset
        pom.setState(s => ({ ...s, expanded: true }))
      } else {
        const detail = (e as CustomEvent).detail as { preset?: number } | undefined
        pom.activate(detail?.preset)
      }
    }
    window.addEventListener('pomodoro:activate', handler)
    return () => window.removeEventListener('pomodoro:activate', handler)
  }, [pom])

  return (
    <div className="flex items-center justify-between h-6 bg-[#0e639c] text-white text-[12px] select-none shrink-0 px-1">
      <div className="flex items-center gap-0">
        <StatusItem>📅 {today}</StatusItem>
      </div>
      <div className="flex items-center gap-0">
        {/* Pomodoro pill — click opens full-screen panel */}
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
