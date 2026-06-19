import { useState, useCallback } from 'react'
import { RefreshCw, Copy, Check, Shield, ShieldAlert, ShieldCheck } from 'lucide-react'
import { showToast } from '../../../lib/toast'

const CHARSETS = {
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{}:,.?',
}

function buildCharset(flags: Record<string, boolean>): string {
  let chars = ''
  if (flags.lower) chars += CHARSETS.lower
  if (flags.upper) chars += CHARSETS.upper
  if (flags.digits) chars += CHARSETS.digits
  if (flags.symbols) chars += CHARSETS.symbols
  return chars
}

function generatePassword(length: number, flags: Record<string, boolean>): string {
  const charset = buildCharset(flags)
  if (!charset) return ''

  // Ensure at least one char from each selected class
  const required: string[] = []
  if (flags.lower) required.push(CHARSETS.lower[Math.floor(Math.random() * CHARSETS.lower.length)])
  if (flags.upper) required.push(CHARSETS.upper[Math.floor(Math.random() * CHARSETS.upper.length)])
  if (flags.digits) required.push(CHARSETS.digits[Math.floor(Math.random() * CHARSETS.digits.length)])
  if (flags.symbols) required.push(CHARSETS.symbols[Math.floor(Math.random() * CHARSETS.symbols.length)])

  if (length < required.length) return required.slice(0, length).join('')

  // Use crypto.getRandomValues for secure randomness
  const array = new Uint32Array(length - required.length)
  crypto.getRandomValues(array)
  const remaining = Array.from(array, v => charset[v % charset.length])

  const all = [...required, ...remaining]
  // Fisher-Yates shuffle with crypto randomness
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor((crypto.getRandomValues(new Uint32Array(1))[0] / 0x100000000) * (i + 1))
    ;[all[i], all[j]] = [all[j], all[i]]
  }
  return all.join('')
}

function estimateStrength(password: string, flags: Record<string, boolean>): { score: number; label: string; color: string } {
  if (!password) return { score: 0, label: '—', color: 'bg-[var(--border-color)]' }

  let score = 0
  const len = password.length

  // Length scoring
  if (len >= 8) score += 1
  if (len >= 12) score += 1
  if (len >= 16) score += 1
  if (len >= 24) score += 1

  // Diversity scoring
  let classes = 0
  if (/[a-z]/.test(password)) classes++
  if (/[A-Z]/.test(password)) classes++
  if (/[0-9]/.test(password)) classes++
  if (/[^a-zA-Z0-9]/.test(password)) classes++
  score += (classes - 1) * 2

  if (score <= 2) return { score, label: '弱', color: 'bg-[var(--danger)]' }
  if (score <= 4) return { score, label: '一般', color: 'bg-[var(--warning)]' }
  if (score <= 6) return { score, label: '强', color: 'bg-[var(--success)]' }
  return { score, label: '极强', color: 'bg-[var(--accent)]' }
}

interface Props {
  onBack: () => void
}

export function PasswordGenerator({ onBack }: Props) {
  const [length, setLength] = useState(16)
  const [flags, setFlags] = useState({
    lower: true,
    upper: true,
    digits: true,
    symbols: true,
  })
  const [password, setPassword] = useState('')
  const [copied, setCopied] = useState(false)

  const flaggedCount = Object.values(flags).filter(Boolean).length

  const handleGenerate = useCallback(() => {
    const pwd = generatePassword(length, flags)
    setPassword(pwd)
    setCopied(false)
  }, [length, flags])

  const handleCopy = useCallback(async () => {
    if (!password) return
    try {
      await navigator.clipboard.writeText(password)
      setCopied(true)
      showToast({ type: 'info', message: '密码已复制到剪贴板' })
      setTimeout(() => setCopied(false), 2000)
    } catch {
      showToast({ type: 'error', message: '复制失败，请手动复制' })
    }
  }, [password])

  const toggleFlag = (key: string) => {
    const next = { ...flags, [key]: !(flags as Record<string, boolean>)[key] }
    if (Object.values(next).filter(Boolean).length === 0) return // at least one
    setFlags(next)
    setPassword('')
  }

  const strength = estimateStrength(password, flags)

  return (
    <div className="flex flex-col h-full bg-[var(--bg-primary)]">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-[var(--border-color)] shrink-0">
        <button
          onClick={onBack}
          className="text-[13px] text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors"
        >
          ← 返回
        </button>
        <h2 className="text-[15px] font-medium text-[var(--text-primary)]">🔐 强密码生成器</h2>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-lg mx-auto px-5 py-6 space-y-6">
          {/* Password output */}
          <div className="space-y-2">
            <label className="text-[12px] text-[var(--text-secondary)]">生成的密码</label>
            <div className="flex items-center gap-2">
              <div className="flex-1 flex items-center bg-[var(--input-bg)] border border-[var(--border-color)] rounded-md px-3 py-2.5 min-h-[40px]">
                <span className={`flex-1 text-[14px] font-mono break-all select-all ${password ? 'text-[var(--text-primary)]' : 'text-[var(--text-disabled)]'}`}>
                  {password || '点击「生成密码」'}
                </span>
                {password && (
                  <button
                    onClick={handleCopy}
                    className="shrink-0 ml-2 p-1 text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"
                    title="复制密码"
                  >
                    {copied ? <Check size={16} className="text-[var(--success)]" /> : <Copy size={16} />}
                  </button>
                )}
              </div>
              <button
                onClick={handleGenerate}
                disabled={flaggedCount === 0}
                className="shrink-0 flex items-center gap-1.5 px-4 py-2.5 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-[13px] font-medium rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <RefreshCw size={14} />
                生成
              </button>
            </div>

            {/* Strength bar */}
            {password && (
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${strength.color}`}
                    style={{ width: `${Math.min(100, (strength.score / 8) * 100)}%` }}
                  />
                </div>
                <span className={`text-[11px] font-medium ${
                  strength.label === '极强' ? 'text-[var(--accent)]' :
                  strength.label === '强' ? 'text-[var(--success)]' :
                  strength.label === '一般' ? 'text-[var(--warning)]' :
                  'text-[var(--danger)]'
                }`}>
                  {strength.label === '极强' && <ShieldCheck size={13} className="inline mr-0.5" />}
                  {strength.label === '强' && <Shield size={13} className="inline mr-0.5" />}
                  {strength.label === '一般' && <ShieldAlert size={13} className="inline mr-0.5" />}
                  {strength.label}
                </span>
              </div>
            )}
          </div>

          {/* Length slider */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[12px] text-[var(--text-secondary)]">密码长度</label>
              <span className="text-[13px] font-mono font-medium text-[var(--accent)]">{length}</span>
            </div>
            <input
              type="range"
              min={4}
              max={64}
              value={length}
              onChange={e => { setLength(Number(e.target.value)); setPassword('') }}
              className="w-full h-1.5 bg-[var(--bg-tertiary)] rounded-full appearance-none cursor-pointer accent-[var(--accent)] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-[var(--accent)] [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:shadow-md"
            />
            <div className="flex justify-between text-[10px] text-[var(--text-disabled)]">
              <span>4</span><span>64</span>
            </div>
          </div>

          {/* Character type toggles */}
          <div className="space-y-2">
            <label className="text-[12px] text-[var(--text-secondary)]">字符类型</label>
            <div className="grid grid-cols-2 gap-2">
              {([
                { key: 'lower', label: '小写字母', sample: 'abc...', icon: 'a-z' },
                { key: 'upper', label: '大写字母', sample: 'ABC...', icon: 'A-Z' },
                { key: 'digits', label: '数字', sample: '012...', icon: '0-9' },
                { key: 'symbols', label: '特殊符号', sample: '!@#...', icon: '!@#' },
              ] as const).map(item => {
                const on = (flags as Record<string, boolean>)[item.key]
                return (
                  <button
                    key={item.key}
                    onClick={() => toggleFlag(item.key)}
                    className={`flex items-center gap-2.5 px-3 py-2.5 rounded-md border-2 transition-all text-left ${
                      on
                        ? 'border-[var(--accent)] bg-[var(--accent)]/10'
                        : 'border-[var(--border-color)] bg-[var(--bg-tertiary)] opacity-50 hover:opacity-80'
                    }`}
                  >
                    <span className={`text-[14px] font-mono font-bold ${on ? 'text-[var(--accent)]' : 'text-[var(--text-disabled)]'}`}>
                      {item.icon}
                    </span>
                    <span className={`text-[12px] ${on ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}`}>
                      {item.label}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Quick actions */}
          <div className="flex items-center gap-2 pt-2">
            <span className="text-[11px] text-[var(--text-muted)]">快捷：</span>
            {[
              { label: '12位', len: 12 },
              { label: '16位', len: 16 },
              { label: '24位', len: 24 },
              { label: '32位', len: 32 },
            ].map(q => (
              <button
                key={q.len}
                onClick={() => { setLength(q.len); setPassword('') }}
                className={`px-2 py-0.5 text-[11px] rounded border transition-colors ${
                  length === q.len
                    ? 'border-[var(--accent)] text-[var(--accent)] bg-[var(--accent)]/10'
                    : 'border-[var(--border-color)] text-[var(--text-muted)] hover:border-[var(--text-secondary)]'
                }`}
              >
                {q.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
