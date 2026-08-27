import { useState, useEffect, useSyncExternalStore } from 'react'
import { Timer, ArrowDownToLine } from 'lucide-react'
import { usePomodoro } from '../../modules/toolbox/hooks/PomodoroContext'
import { localToday } from '../../lib/date'
import { subscribePluginDownloads, getPluginDownloads } from '../../lib/pluginDownloadBus'

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
  const today = date || localToday()
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

  // ---- 插件后台下载全局指示(总线快照订阅,组件无关页面存活) ----
  const pluginDls = useSyncExternalStore(subscribePluginDownloads, getPluginDownloads)
  const activeDls = pluginDls.filter(d => d.status === 'downloading' || d.status === 'finishing')

  return (
    <div className="flex items-center justify-between h-6 bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border-t border-[var(--border-color)] text-[12px] select-none shrink-0 px-1">
      <div className="flex items-center gap-0">
        <StatusItem>馃搮 {today}</StatusItem>
        {activeDls.map((d, i) => (
          <StatusItem key={d.key} className={i > 0 ? 'border-l border-[var(--border-color)]' : ''}>
            <span data-plugin-dl={d.name} className="flex items-center gap-1" title={`插件后台下载中:${d.name}${d.host ? `(经 ${d.host})` : ''}`}>
              <ArrowDownToLine size={11} className="inline-block animate-pulse" />
              <span className="max-w-[140px] truncate">{d.name}</span>
              <span className="font-mono ml-0.5">
                {d.pct > 0 || d.receivedMb <= 0 ? `${d.pct}%` : `${d.receivedMb}MB`}
              </span>
            </span>
          </StatusItem>
        ))}
      </div>
      <div className="flex items-center gap-0">
        {/* Pomodoro pill — click opens full-screen panel */}
        {ps.visible && (
          <button
            onClick={() => pom.setState(s => ({ ...s, expanded: !s.expanded }))}
            className={`h-full flex items-center gap-1.5 px-2 hover:bg-[var(--bg-hover)] transition-colors cursor-pointer text-[11px] font-medium ${
              ps.expanded ? 'bg-[var(--bg-hover)]' : ''
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

function StatusItem({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`px-2 h-full flex items-center hover:bg-[var(--bg-hover)] cursor-default transition-colors ${className}`}>
      {children}
    </span>
  )
}
