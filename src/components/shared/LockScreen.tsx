import { useState, useEffect, useRef } from 'react'
import { Lock } from 'lucide-react'
import { useSettings } from '../../lib/SettingsContext'

function useClock(active: boolean) {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    if (!active) return
    setNow(new Date())
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [active])
  return now
}

interface Props {
  locked: boolean
  onUnlock: () => void
}

export function LockScreen({ locked, onUnlock }: Props) {
  const [visible, setVisible] = useState(false)
  const [animate, setAnimate] = useState(false)
  const [pwd, setPwd] = useState('')
  const [shaking, setShaking] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const { s } = useSettings()

  const hasPassword = s.lockPassword.length > 0
  const now = useClock(locked)

  useEffect(() => {
    if (locked) {
      setVisible(true)
      setPwd('')
      setShaking(false)
      requestAnimationFrame(() => requestAnimationFrame(() => {
        setAnimate(true)
        setTimeout(() => { if (hasPassword) inputRef.current?.focus() }, 450)
      }))
    } else if (visible) {
      setAnimate(false)
      const t = setTimeout(() => setVisible(false), 500)
      return () => clearTimeout(t)
    }
  }, [locked])

  // Escape key to unlock (only when no password is set)
  useEffect(() => {
    if (!locked) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !hasPassword) onUnlock()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [locked, onUnlock, hasPassword])

  const handleSubmit = () => {
    if (pwd === s.lockPassword) {
      setPwd('')
      onUnlock()
    } else {
      setShaking(true)
      setPwd('')
      setTimeout(() => setShaking(false), 500)
      inputRef.current?.focus()
    }
  }

  if (!visible) return null

  const timeStr = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  const dateStr = now.toLocaleDateString('zh-CN', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
  })

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[#0d0d0d] select-none"
      style={{
        transform: animate ? 'translateY(0)' : 'translateY(-100%)',
        transition: 'transform 0.45s cubic-bezier(0.4, 0, 0.2, 1)',
      }}
    >
      {/* Top light bleed */}
      <div className="absolute top-0 left-0 right-0 h-40 bg-gradient-to-b from-[#16162a] via-[#0f0f1a] to-transparent pointer-events-none" />
      {/* Bottom subtle gradient */}
      <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-[#0a0a14] to-transparent pointer-events-none" />

      <div className={`flex flex-col items-center z-10 gap-4 ${shaking ? 'animate-[shake_0.4s_ease-in-out]' : ''}`}>
        <Lock size={40} strokeWidth={1} className="text-[#3a3a3a]" />

        <div className="text-[72px] font-thin text-[#e8e8e8] tracking-[6px] font-mono leading-none select-none">
          {timeStr}
        </div>

        <div className="text-[13px] text-[#666666] tracking-wider -mt-1">
          {dateStr}
        </div>

        {hasPassword ? (
          <div className="mt-10 flex flex-col items-center gap-5">
            {/* Hidden input captures keystrokes */}
            <input
              ref={inputRef}
              type="password"
              value={pwd}
              onChange={e => setPwd(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSubmit() }}
              className="absolute opacity-0 pointer-events-none"
              autoFocus
            />

            {/* 6 pin dots */}
            <button
              onClick={() => inputRef.current?.focus()}
              className="flex items-center gap-4 cursor-text"
            >
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className={`w-4 h-4 rounded-full border transition-all duration-200 ${
                    i < pwd.length
                      ? 'bg-[#e0e0e0] border-[#e0e0e0] shadow-[0_0_8px_rgba(255,255,255,0.15)]'
                      : 'bg-transparent border-[#3a3a3a]'
                  } ${i === pwd.length ? 'border-[#888888]' : ''}`}
                />
              ))}
            </button>

            <div className="flex items-center gap-4">
              <button
                onClick={() => setPwd('')}
                className="text-[12px] text-[#444444] hover:text-[#777777] transition-colors"
              >
                清除
              </button>
              <button
                onClick={handleSubmit}
                disabled={!pwd}
                className="px-5 py-1.5 text-[12px] text-[#888888] hover:text-[#cccccc] transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
              >
                解锁
              </button>
            </div>

            {shaking && (
              <span className="text-[12px] text-[#e05555] animate-[fadeIn_0.2s_ease-out]">密码错误</span>
            )}
          </div>
        ) : (
          <div
            onClick={onUnlock}
            className="mt-10 text-[12px] text-[#3a3a3a] animate-pulse cursor-pointer tracking-wide"
          >
            点击任意位置解锁
          </div>
        )}
      </div>

      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-8px); }
          40% { transform: translateX(8px); }
          60% { transform: translateX(-6px); }
          80% { transform: translateX(6px); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
    </div>
  )
}
