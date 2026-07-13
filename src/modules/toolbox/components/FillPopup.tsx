import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { Search, X, Shield, User, Key, AtSign, ArrowRight, Check, Loader2 } from 'lucide-react'
import type { PasswordEntry } from '../../../types'

type Feedback = 'idle' | 'filling' | 'done'

export function FillPopup() {
  const [entries, setEntries] = useState<PasswordEntry[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [feedback, setFeedback] = useState<Feedback>('idle')
  const searchRef = useRef<HTMLInputElement>(null)

  const loadEntries = useCallback(() => {
    setLoading(true)
    window.api.fillPopupGetEntries().then((e: PasswordEntry[]) => {
      setEntries(e); setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  useEffect(() => {
    const unsubRefresh = window.api.onFillPopupRefresh(() => {
      setFeedback('idle'); setSelectedId(null); setSearchQuery(''); loadEntries()
    })
    const unsubFeedback = window.api.onFillPopupFeedback((state: string) => {
      if (state === 'filling') setFeedback('filling')
      if (state === 'done') { setFeedback('done'); setTimeout(() => window.api.fillPopupHide(), 800) }
    })
    loadEntries()
    setTimeout(() => searchRef.current?.focus(), 50)
    return () => { unsubRefresh(); unsubFeedback() }
  }, [loadEntries])

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return entries
    return entries.filter(e =>
      e.title.toLowerCase().includes(q) || e.account.toLowerCase().includes(q) ||
      e.username.toLowerCase().includes(q) || e.url.toLowerCase().includes(q)
    )
  }, [entries, searchQuery])

  const selected = entries.find(e => e.id === selectedId) || null

  const handleFill = useCallback((mode: 'all' | 'passwordOnly') => {
    if (!selected) return
    window.api.fillPopupFill({
      account: selected.account, username: selected.username,
      password: selected.password, mode,
    })
    setFeedback('filling')
  }, [selected])

  const handleHide = useCallback(() => window.api.fillPopupHide(), [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { if (searchQuery) { setSearchQuery(''); return } handleHide(); return }
    if (e.key === 'Enter' && selected) { e.preventDefault(); handleFill('all'); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); const idx = filtered.findIndex(en => en.id === selectedId); if (idx < filtered.length - 1) setSelectedId(filtered[idx + 1].id) }
    if (e.key === 'ArrowUp') { e.preventDefault(); const idx = filtered.findIndex(en => en.id === selectedId); if (idx > 0) setSelectedId(filtered[idx - 1].id) }
  }, [searchQuery, selected, filtered, selectedId, handleHide, handleFill])

  if (feedback === 'filling') {
    return <div className="flex flex-col items-center justify-center h-screen bg-[var(--bg-primary)] gap-3"><Loader2 size={24} className="animate-spin text-[var(--accent)]" /><p className="text-[12px] text-[var(--text-muted)]">正在填充...</p></div>
  }
  if (feedback === 'done') {
    return <div className="flex flex-col items-center justify-center h-screen bg-[var(--bg-primary)] gap-2"><Check size={28} className="text-green-500" /><p className="text-[12px] text-[var(--text-primary)] font-medium">已填充</p></div>
  }

  return (
    <div className="flex flex-col h-screen bg-[var(--bg-primary)] overflow-hidden" onKeyDown={handleKeyDown} tabIndex={-1}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] shrink-0" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <div className="flex items-center gap-2"><Shield size={14} className="text-[var(--accent)]" /><span className="text-[12px] font-semibold text-[var(--text-primary)]">Knowbase 填充</span></div>
        <button onClick={handleHide} className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}><X size={14} /></button>
      </div>
      <div className="px-3 py-2 shrink-0">
        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input ref={searchRef} value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="搜索..." className="w-full pl-7 pr-3 py-1.5 bg-[var(--input-bg)] border border-[var(--border-color)] rounded text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-disabled)]" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties} />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        {loading ? <div className="flex items-center justify-center py-8 text-[11px] text-[var(--text-muted)]">加载中...</div>
        : filtered.length === 0 ? <div className="flex flex-col items-center justify-center py-8 text-[11px] text-[var(--text-muted)] gap-1"><Shield size={20} className="opacity-20 mb-1" /><p>{entries.length === 0 ? '密码本为空' : '无匹配结果'}</p></div>
        : <div className="py-0.5">{filtered.map(e => (
          <div key={e.id} onClick={() => setSelectedId(e.id)} onDoubleClick={() => { setSelectedId(e.id); handleFill('all') }}
            className={`px-3 py-1.5 cursor-pointer transition-colors border-l-[3px] ${selectedId === e.id ? 'bg-[var(--bg-selected)] border-l-[var(--accent)]' : 'border-l-transparent hover:bg-[var(--bg-hover)]'}`}>
            <div className="text-[12px] text-[var(--text-primary)] font-medium truncate">{e.title || '未命名'}</div>
            <div className="flex items-center gap-2 mt-0.5 text-[10px]">
              {e.account && <span className="text-[var(--text-muted)] flex items-center gap-0.5"><AtSign size={9} />{e.account}</span>}
              {e.username && <span className="text-[var(--text-muted)] flex items-center gap-0.5"><User size={9} />{e.username}</span>}
            </div>
            <div className="text-[9px] text-[var(--text-disabled)] font-mono tracking-wider mt-0.5">••••••••</div>
          </div>
        ))}</div>}
      </div>
      {selected && feedback === 'idle' && (
        <div className="flex items-center gap-2 px-3 py-2 border-t border-[var(--border-color)] bg-[var(--bg-secondary)] shrink-0" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <div className="flex-1 text-[10px] text-[var(--text-muted)] truncate">{selected.title || '未命名'}{selected.account && <span className="ml-1 text-[var(--text-disabled)]">· {selected.account}</span>}</div>
          <button onClick={() => handleFill('passwordOnly')} className="flex items-center gap-1 px-2.5 py-1 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-color)] rounded hover:bg-[var(--bg-hover)] transition-colors"><Key size={11} /> 密码</button>
          <button onClick={() => handleFill('all')} className="flex items-center gap-1 px-2.5 py-1 text-[11px] bg-[var(--accent)] text-white rounded hover:bg-[var(--accent-hover)] transition-colors"><ArrowRight size={11} /> 填充</button>
        </div>
      )}
    </div>
  )
}
