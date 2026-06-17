import { useState, useEffect, useCallback } from 'react'
import { User, Clock } from 'lucide-react'
import type { UserProfile, UserStats } from '../../types'
import { getUserProfile, setUserUsername, getUserStats } from '../../lib/ipc'
import { showToast } from '../../lib/toast'
import { AvatarUpload } from './components/AvatarUpload'
import { PasswordSection } from './components/PasswordSection'
import { StatsPanel } from './components/StatsPanel'

export function UserModule() {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [stats, setStats] = useState<UserStats | null>(null)
  const [username, setUsername] = useState('')
  const [editing, setEditing] = useState(false)

  const loadData = useCallback(async () => {
    const [p, s] = await Promise.all([getUserProfile(), getUserStats()])
    setProfile(p)
    setStats(s)
    if (p) setUsername(p.username)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const handleSaveUsername = async () => {
    const trimmed = username.trim()
    if (!trimmed) { setUsername(profile?.username || ''); setEditing(false); return }
    await setUserUsername(trimmed)
    setProfile(prev => prev ? { ...prev, username: trimmed } : null)
    setEditing(false)
    showToast({ type: 'info', message: '用户名已更新' })
  }

  const handlePasswordChanged = (hasPwd: boolean) => {
    setProfile(prev => prev ? { ...prev, hasPassword: hasPwd } : null)
  }

  const handleAvatarChanged = (path: string) => {
    setProfile(prev => prev ? { ...prev, avatarPath: path } : null)
  }

  if (!profile) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--text-muted)]">
        加载中...
      </div>
    )
  }

  const createdAt = profile.createdAt ? new Date(profile.createdAt).toLocaleDateString('zh-CN') : '-'

  return (
    <div className="flex flex-col h-full bg-[var(--bg-primary)]">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-[var(--border-color)] shrink-0">
        <div className="flex items-center gap-2">
          <User size={17} className="text-[var(--accent)]" />
          <span className="text-[14px] font-semibold text-[var(--text-primary)]">用户</span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-xl mx-auto px-6 py-8 space-y-8">
          {/* Avatar + Username */}
          <div className="flex items-center gap-6">
            <AvatarUpload
              avatarPath={profile.avatarPath}
              onAvatarChanged={handleAvatarChanged}
            />

            <div className="flex-1 space-y-3">
              {/* Username */}
              <div className="flex items-center gap-2">
                {editing ? (
                  <>
                    <input
                      autoFocus
                      value={username}
                      onChange={e => setUsername(e.target.value)}
                      onBlur={handleSaveUsername}
                      onKeyDown={e => { if (e.key === 'Enter') handleSaveUsername(); if (e.key === 'Escape') { setUsername(profile.username); setEditing(false) } }}
                      placeholder="输入用户名..."
                      className="w-48 px-2.5 py-1.5 bg-[var(--input-bg)] border border-[var(--accent)] rounded text-[15px] font-medium text-[var(--text-primary)] outline-none"
                    />
                  </>
                ) : (
                  <div className="flex items-center gap-2">
                    <h2
                      className="text-[18px] font-semibold text-[var(--text-primary)] cursor-pointer hover:text-[var(--accent)] transition-colors"
                      onClick={() => setEditing(true)}
                      title="点击修改用户名"
                    >
                      {profile.username || '未设置用户名'}
                    </h2>
                    <button
                      onClick={() => setEditing(true)}
                      className="text-[11px] text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"
                    >
                      编辑
                    </button>
                  </div>
                )}
              </div>

              {/* Password */}
              <PasswordSection
                hasPassword={profile.hasPassword}
                onPasswordChanged={handlePasswordChanged}
              />

              {/* Created at */}
              <div className="flex items-center gap-2 text-[12px] text-[var(--text-muted)]">
                <Clock size={12} />
                <span>创建于 {createdAt}</span>
              </div>
            </div>
          </div>

          {/* Divider */}
          <div className="border-t border-[var(--border-color)]" />

          {/* Stats */}
          <StatsPanel stats={stats} />
        </div>
      </div>
    </div>
  )
}
