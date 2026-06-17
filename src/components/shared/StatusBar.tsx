import { useState, useEffect } from 'react'

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
    // Reset when switching tabs
    const resetHandler = () => setCurrentFileType('Markdown')
    window.addEventListener('tab-switched', resetHandler)
    return () => {
      window.removeEventListener('status-filetype', handler)
      window.removeEventListener('tab-switched', resetHandler)
    }
  }, [])

  return (
    <div className="flex items-center justify-between h-6 bg-[#0e639c] text-white text-[12px] select-none shrink-0 px-1">
      <div className="flex items-center gap-0">
        <StatusItem>📅 {today}</StatusItem>
      </div>
      <div className="flex items-center gap-0">
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
