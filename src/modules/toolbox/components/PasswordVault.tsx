import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { ArrowLeft, Search, Eye, EyeOff, Copy, Plus, Trash2, ExternalLink, X, Check, Shield, Globe, User, Key, FileText } from 'lucide-react'
import type { PasswordEntry } from '../../../types'
import { getPasswordEntries, createPasswordEntry, updatePasswordEntry, deletePasswordEntry, openExternal } from '../../../lib/ipc'
import { showToast } from '../../../lib/toast'

interface Props {
  onBack: () => void
}

export function PasswordVault({ onBack }: Props) {
  const [entries, setEntries] = useState<PasswordEntry[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)

  // Edit fields
  const [title, setTitle] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [url, setUrl] = useState('')
  const [notes, setNotes] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [saving, setSaving] = useState(false)
  const [copiedUser, setCopiedUser] = useState(false)
  const [copiedPass, setCopiedPass] = useState(false)

  // New entry form
  const [showNewForm, setShowNewForm] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newUsername, setNewUsername] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newUrl, setNewUrl] = useState('')
  const [newNotes, setNewNotes] = useState('')

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  const saveTimer = useRef<ReturnType<typeof setTimeout>>()
  const selectedRef = useRef(selectedId)
  const titleRef = useRef(title)
  const usernameRef = useRef(username)
  const passwordRef = useRef(password)
  const urlRef = useRef(url)
  const notesRef = useRef(notes)
  const clipboardTimer = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => { selectedRef.current = selectedId }, [selectedId])
  useEffect(() => { titleRef.current = title }, [title])
  useEffect(() => { usernameRef.current = username }, [username])
  useEffect(() => { passwordRef.current = password }, [password])
  useEffect(() => { urlRef.current = url }, [url])
  useEffect(() => { notesRef.current = notes }, [notes])

  // Load entries
  useEffect(() => {
    getPasswordEntries().then(e => { setEntries(e); setLoading(false) }).catch(() => setLoading(false))
  }, [])

  // Reset visible password when switching entries
  useEffect(() => {
    setShowPassword(false)
    setCopiedUser(false)
    setCopiedPass(false)
  }, [selectedId])

  // Clear clipboard timer on unmount
  useEffect(() => {
    return () => { if (clipboardTimer.current) clearTimeout(clipboardTimer.current) }
  }, [])

  // Filtered entries
  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return entries
    return entries.filter(e =>
      e.title.toLowerCase().includes(q) ||
      e.username.toLowerCase().includes(q) ||
      e.url.toLowerCase().includes(q)
    )
  }, [entries, searchQuery])

  // Auto-save effect (1s debounce)
  const doSave = useCallback(async () => {
    const id = selectedRef.current
    if (!id) return
    setSaving(true)
    try {
      await updatePasswordEntry(id, {
        title: titleRef.current,
        username: usernameRef.current,
        password: passwordRef.current,
        url: urlRef.current,
        notes: notesRef.current,
      })
      setEntries(prev => prev.map(e => e.id === id
        ? { ...e, title: titleRef.current, username: usernameRef.current, password: passwordRef.current, url: urlRef.current, notes: notesRef.current, updatedAt: new Date().toISOString() }
        : e
      ))
    } catch (e) { console.error(e) } finally { setSaving(false) }
  }, [])

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    setSaving(true)
    saveTimer.current = setTimeout(() => doSave(), 1000)
  }, [doSave])

  // Select entry
  const handleSelect = useCallback((entry: PasswordEntry) => {
    if (saveTimer.current) { clearTimeout(saveTimer.current); doSave() }
    setSelectedId(entry.id)
    setTitle(entry.title)
    setUsername(entry.username)
    setPassword(entry.password)
    setUrl(entry.url)
    setNotes(entry.notes)
  }, [doSave])

  // Create new entry
  const handleCreate = async () => {
    if (!newTitle.trim()) return
    try {
      const entry = await createPasswordEntry({
        title: newTitle.trim(),
        username: newUsername.trim(),
        password: newPassword,
        url: newUrl.trim(),
        notes: newNotes.trim(),
      })
      setEntries(prev => [entry, ...prev])
      setShowNewForm(false)
      setNewTitle(''); setNewUsername(''); setNewPassword(''); setNewUrl(''); setNewNotes('')
      handleSelect(entry)
      showToast({ type: 'info', message: '已添加密码条目' })
    } catch (e) { console.error(e); showToast({ type: 'error', message: '添加失败' }) }
  }

  // Copy helpers
  const handleCopyText = (text: string, type: 'user' | 'pass') => {
    navigator.clipboard.writeText(text).then(() => {
      if (type === 'user') { setCopiedUser(true); setTimeout(() => setCopiedUser(false), 2000) }
      else {
        setCopiedPass(true); setTimeout(() => setCopiedPass(false), 2000)
        if (clipboardTimer.current) clearTimeout(clipboardTimer.current)
        clipboardTimer.current = setTimeout(() => navigator.clipboard.writeText('').catch(() => {}), 30000)
      }
      showToast({ type: 'info', message: type === 'user' ? '用户名已复制' : '密码已复制（30秒后自动清除）' })
    }).catch(() => showToast({ type: 'error', message: '复制失败' }))
  }

  const handleOpenUrl = (u: string) => {
    if (!u) return
    const href = u.startsWith('http://') || u.startsWith('https://') ? u : `https://${u}`
    openExternal(href)
  }

  const handleDelete = async (id: string) => {
    setDeleteTarget(null)
    try {
      await deletePasswordEntry(id)
      setEntries(prev => prev.filter(e => e.id !== id))
      if (selectedId === id) {
        setSelectedId(null)
        setTitle(''); setUsername(''); setPassword(''); setUrl(''); setNotes('')
      }
      showToast({ type: 'info', message: '已删除' })
    } catch (e) { console.error(e); showToast({ type: 'error', message: '删除失败' }) }
  }

  const selected = entries.find(e => e.id === selectedId) || null

  return (
    <div className="flex flex-col h-full bg-[var(--bg-primary)]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => { if (saveTimer.current) { clearTimeout(saveTimer.current); doSave() }; onBack() }}
            className="flex items-center gap-1 text-[13px] text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors"
          >
            <ArrowLeft size={16} /> 返回
          </button>
          <div className="w-px h-4 bg-[var(--border-color)]" />
          <Shield size={17} className="text-[var(--accent)]" />
          <h2 className="text-[14px] font-semibold text-[var(--text-primary)]">密码本</h2>
          <span className="text-[11px] text-[var(--text-muted)]">{entries.length} 条</span>
        </div>
        <button
          onClick={() => { setShowNewForm(true); setNewTitle(''); setNewUsername(''); setNewPassword(''); setNewUrl(''); setNewNotes('') }}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] bg-[var(--accent)] text-white rounded hover:bg-[var(--accent-hover)] transition-colors"
        >
          <Plus size={14} /> 新建
        </button>
      </div>

      {/* Content: search + list | detail */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left panel: search + list */}
        <div className="w-[240px] min-w-[200px] border-r border-[var(--border-color)] bg-[var(--bg-secondary)] flex flex-col">
          {/* Search bar — integrated into list panel */}
          <div className="px-3 py-2 shrink-0">
            <div className="relative">
              <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="搜索..."
                className="w-full pl-7 pr-7 py-1 bg-[var(--input-bg)] border border-[var(--border-color)] rounded text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-disabled)]"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                  <X size={11} />
                </button>
              )}
            </div>
            {searchQuery && (
              <p className="text-[10px] text-[var(--text-muted)] mt-1 px-1">{filtered.length} / {entries.length} 条</p>
            )}
          </div>

          {/* Entry list */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-10 text-[12px] text-[var(--text-muted)]">加载中...</div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 px-4">
                <Shield size={28} className="text-[var(--text-disabled)] mb-3 opacity-30" />
                <p className="text-[12px] text-[var(--text-muted)] text-center">
                  {entries.length === 0 ? '暂无密码条目' : '无匹配结果'}
                </p>
                {entries.length === 0 && (
                  <button onClick={() => setShowNewForm(true)} className="mt-3 text-[12px] text-[var(--accent)] hover:underline">添加第一条</button>
                )}
              </div>
            ) : (
              <div className="py-1">
                {filtered.map(e => (
                  <div
                    key={e.id}
                    onClick={() => handleSelect(e)}
                    onContextMenu={e_ => { e_.preventDefault(); setDeleteTarget(e.id) }}
                    className={`px-3 py-2 cursor-pointer transition-colors border-l-[3px] ${
                      selectedId === e.id
                        ? 'bg-[var(--bg-selected)] border-l-[var(--accent)]'
                        : 'border-l-transparent hover:bg-[var(--bg-hover)]'
                    }`}
                  >
                    <div className="text-[12px] text-[var(--text-primary)] font-medium truncate">{e.title || '未命名'}</div>
                    <div className="text-[10px] text-[var(--text-muted)] truncate mt-0.5">
                      {e.username ? `👤 ${e.username}` : '无用户名'}
                    </div>
                    <div className="text-[9px] text-[var(--text-disabled)] font-mono tracking-wider mt-0.5">••••••••</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: detail panel */}
        <div className="flex-1 overflow-y-auto bg-[var(--bg-primary)]">
          {selected ? (
            <div className="px-8 py-6 space-y-5">
              {/* Save indicator */}
              <div className="flex items-center justify-end gap-1.5 text-[11px]">
                <span className={`w-2 h-2 rounded-full ${saving ? 'bg-[var(--warning)]' : 'bg-green-500'}`} />
                <span className="text-[var(--text-muted)]">{saving ? '未保存' : '已保存'}</span>
              </div>

              {/* Title */}
              <div className="space-y-1.5">
                <label className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--text-secondary)] uppercase tracking-wide">
                  <Globe size={12} /> 名称
                </label>
                <input
                  value={title}
                  onChange={e => { setTitle(e.target.value); scheduleSave() }}
                  placeholder="网站 / 应用名称"
                  className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--border-color)] rounded-md text-[15px] text-[var(--text-primary)] font-semibold outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-disabled)]"
                />
              </div>

              {/* Username + Password side by side */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--text-secondary)] uppercase tracking-wide">
                    <User size={12} /> 用户名
                  </label>
                  <div className="flex gap-1.5">
                    <input
                      value={username}
                      onChange={e => { setUsername(e.target.value); scheduleSave() }}
                      placeholder="用户名 / 邮箱"
                      className="flex-1 px-3 py-2 bg-[var(--input-bg)] border border-[var(--border-color)] rounded-md text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-disabled)]"
                    />
                    <button
                      onClick={() => username && handleCopyText(username, 'user')}
                      disabled={!username}
                      className="shrink-0 w-8 h-8 flex items-center justify-center rounded-md text-[var(--text-secondary)] hover:text-white hover:bg-[var(--accent)] disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                      title="复制用户名"
                    >
                      {copiedUser ? <Check size={15} /> : <Copy size={15} />}
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--text-secondary)] uppercase tracking-wide">
                    <Key size={12} /> 密码
                  </label>
                  <div className="flex gap-1.5">
                    <div className="flex-1 flex items-center bg-[var(--input-bg)] border border-[var(--border-color)] rounded-md overflow-hidden">
                      <input
                        value={showPassword ? password : (password ? '••••••••' : '')}
                        onChange={e => { setPassword(e.target.value); scheduleSave() }}
                        readOnly={!showPassword}
                        onClick={() => { if (!showPassword) { setShowPassword(true); requestAnimationFrame(() => { const inp = document.activeElement as HTMLInputElement; if (inp) { inp.focus(); inp.select() } }) } }}
                        className={`flex-1 px-3 py-2 bg-transparent text-[13px] text-[var(--text-primary)] outline-none font-mono ${!showPassword ? 'cursor-pointer select-none' : ''}`}
                        placeholder="密码"
                      />
                      <button
                        onClick={() => setShowPassword(v => !v)}
                        className="shrink-0 px-2 py-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                        title={showPassword ? '隐藏' : '显示'}
                      >
                        {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                    <button
                      onClick={() => password && handleCopyText(password, 'pass')}
                      disabled={!password}
                      className="shrink-0 w-8 h-8 flex items-center justify-center rounded-md text-[var(--text-secondary)] hover:text-white hover:bg-[var(--accent)] disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                      title="复制密码"
                    >
                      {copiedPass ? <Check size={15} /> : <Copy size={15} />}
                    </button>
                  </div>
                </div>
              </div>

              {/* URL */}
              <div className="space-y-1.5">
                <label className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--text-secondary)] uppercase tracking-wide">
                  <ExternalLink size={12} /> 网址
                </label>
                <div className="flex gap-1.5">
                  <input
                    value={url}
                    onChange={e => { setUrl(e.target.value); scheduleSave() }}
                    placeholder="example.com"
                    className="flex-1 px-3 py-2 bg-[var(--input-bg)] border border-[var(--border-color)] rounded-md text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-disabled)]"
                  />
                  <button
                    onClick={() => handleOpenUrl(url)}
                    disabled={!url}
                    className="shrink-0 w-8 h-8 flex items-center justify-center rounded-md text-[var(--text-secondary)] hover:text-white hover:bg-[var(--accent)] disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                    title="打开网址"
                  >
                    <ExternalLink size={15} />
                  </button>
                </div>
              </div>

              {/* Notes */}
              <div className="space-y-1.5">
                <label className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--text-secondary)] uppercase tracking-wide">
                  <FileText size={12} /> 备注
                </label>
                <textarea
                  value={notes}
                  onChange={e => { setNotes(e.target.value); scheduleSave() }}
                  placeholder="备注信息..."
                  rows={4}
                  className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--border-color)] rounded-md text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-disabled)] resize-none"
                />
              </div>

              {/* Meta + Delete */}
              <div className="pt-4 border-t border-[var(--border-color)]">
                <div className="text-[10px] text-[var(--text-muted)] space-y-0.5 mb-3">
                  <p>创建：{selected.createdAt ? fmtDate(new Date(selected.createdAt)) : '—'}</p>
                  <p>修改：{selected.updatedAt ? fmtDate(new Date(selected.updatedAt)) : '—'}</p>
                </div>
                <button
                  onClick={() => setDeleteTarget(selected.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-[var(--danger)] hover:bg-[#e8112320] rounded transition-colors"
                >
                  <Trash2 size={14} /> 删除此条目
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-[var(--text-muted)] gap-2">
              <Shield size={40} className="opacity-15 mb-2" />
              <p className="text-[13px]">选择一个条目查看详情</p>
              <p className="text-[11px] text-[var(--text-disabled)]">或点击右上角「新建」添加密码</p>
            </div>
          )}
        </div>
      </div>

      {/* New Entry Modal */}
      {showNewForm && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50" onClick={() => setShowNewForm(false)}>
          <div
            className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg shadow-2xl flex flex-col"
            style={{ width: '420px' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-color)]">
              <span className="text-[13px] font-semibold text-[var(--text-primary)]">新建密码条目</span>
              <button onClick={() => setShowNewForm(false)} className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors">
                <X size={16} />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="text-[11px] font-medium text-[var(--text-secondary)] block mb-1">名称 <span className="text-[var(--danger)]">*</span></label>
                <input
                  autoFocus
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setShowNewForm(false) }}
                  placeholder="网站 / 应用名称"
                  className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--border-color)] rounded-md text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-disabled)]"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-medium text-[var(--text-secondary)] block mb-1">用户名</label>
                  <input
                    value={newUsername}
                    onChange={e => setNewUsername(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleCreate() }}
                    placeholder="用户名 / 邮箱"
                    className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--border-color)] rounded-md text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-disabled)]"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-[var(--text-secondary)] block mb-1">密码</label>
                  <input
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleCreate() }}
                    placeholder="密码"
                    className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--border-color)] rounded-md text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-disabled)]"
                  />
                </div>
              </div>
              <div>
                <label className="text-[11px] font-medium text-[var(--text-secondary)] block mb-1">网址</label>
                <input
                  value={newUrl}
                  onChange={e => setNewUrl(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleCreate() }}
                  placeholder="example.com"
                  className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--border-color)] rounded-md text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-disabled)]"
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-[var(--text-secondary)] block mb-1">备注</label>
                <textarea
                  value={newNotes}
                  onChange={e => setNewNotes(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Escape') setShowNewForm(false) }}
                  placeholder="备注信息..."
                  rows={2}
                  className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--border-color)] rounded-md text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-disabled)] resize-none"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[var(--border-color)]">
              <button onClick={() => setShowNewForm(false)} className="px-4 py-1.5 text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded hover:bg-[var(--bg-hover)] transition-colors">取消</button>
              <button onClick={handleCreate} disabled={!newTitle.trim()} className="px-4 py-1.5 text-[12px] bg-[var(--accent)] text-white rounded hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors">添加</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {deleteTarget && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50" onClick={() => setDeleteTarget(null)}>
          <div
            className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg shadow-2xl p-5"
            style={{ width: '360px' }}
            onClick={e => e.stopPropagation()}
          >
            <p className="text-[13px] text-[var(--text-primary)] mb-1 font-medium">确认删除</p>
            <p className="text-[11px] text-[var(--text-muted)] mb-4">此操作不可撤销，确定要删除此密码条目吗？</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleteTarget(null)} className="px-4 py-1.5 text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded hover:bg-[var(--bg-hover)] transition-colors">取消</button>
              <button onClick={() => handleDelete(deleteTarget)} className="px-4 py-1.5 text-[12px] bg-[var(--danger)] text-white rounded hover:bg-[#c62828] transition-colors">删除</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function fmtDate(d: Date): string {
  const now = Date.now()
  const diff = now - d.getTime()
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`
  const today = new Date()
  if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return '昨天 ' + d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) + ' ' + d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}
