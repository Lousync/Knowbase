import { useState, useEffect, useCallback } from 'react'
import { User, Clock, Lock, Eye, EyeOff } from 'lucide-react'
import type { UserProfile, UserStats } from '../../types'
import { getUserProfile, setUserUsername, getUserStats } from '../../lib/ipc'
import { showToast } from '../../lib/toast'
import { useSettings } from '../../lib/SettingsContext'
import { AvatarUpload } from './components/AvatarUpload'
import { PasswordSection } from './components/PasswordSection'
import { StatsPanel } from './components/StatsPanel'

export function UserModule() {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [stats, setStats] = useState<UserStats | null>(null)
  const [username, setUsername] = useState('')
  const [editing, setEditing] = useState(false)
  const { s, update } = useSettings()

  // ---- Lock screen password ----
  const [lockPwd, setLockPwd] = useState('')
  const [lockConfirm, setLockConfirm] = useState('')
  const [showLockPwd, setShowLockPwd] = useState(false)
  const [lockMsg, setLockMsg] = useState<'success' | 'error' | null>(null)

  const handleLockPassword = () => {
    if (!lockPwd) {
      update('lockPassword', '')
      setLockPwd(''); setLockConfirm('')
      setLockMsg('success')
      setTimeout(() => setLockMsg(null), 2000)
      return
    }
    if (lockPwd !== lockConfirm) {
      setLockMsg('error')
      setTimeout(() => setLockMsg(null), 2000)
      return
    }
    update('lockPassword', lockPwd)
    setLockPwd(''); setLockConfirm('')
    setLockMsg('success')
    setTimeout(() => setLockMsg(null), 2000)
  }

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

              {/* Password (for import/export) */}
              <PasswordSection
                hasPassword={profile.hasPassword}
                onPasswordChanged={handlePasswordChanged}
              />

              {/* Lock screen password */}
              <div className="pt-3 border-t border-[var(--border-color)]">
                <div className="flex items-center gap-2 mb-2">
                  <Lock size={14} className="text-[var(--text-muted)]" />
                  <span className="text-[12px] font-medium text-[var(--text-secondary)]">锁屏密码</span>
                  <span className="text-[10px] text-[var(--text-disabled)]">TitleBar 点击 🔒 后需输入此密码解锁</span>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <input
                        type={showLockPwd ? 'text' : 'password'}
                        value={lockPwd}
                        onChange={e => { setLockPwd(e.target.value); setLockMsg(null) }}
                        placeholder="新密码（留空则清除）"
                        className="w-full px-2.5 py-1.5 pr-8 text-[12px] rounded border bg-[var(--input-bg)] border-[var(--border-color)] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-disabled)]"
                      />
                      <button
                        onClick={() => setShowLockPwd(v => !v)}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                        tabIndex={-1}
                      >
                        {showLockPwd ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type={showLockPwd ? 'text' : 'password'}
                      value={lockConfirm}
                      onChange={e => { setLockConfirm(e.target.value); setLockMsg(null) }}
                      onKeyDown={e => { if (e.key === 'Enter') handleLockPassword() }}
                      placeholder="确认密码"
                      className="flex-1 px-2.5 py-1.5 text-[12px] rounded border bg-[var(--input-bg)] border-[var(--border-color)] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-disabled)]"
                    />
                    <button
                      onClick={handleLockPassword}
                      disabled={lockPwd !== lockConfirm}
                      className="px-3 py-1.5 text-[12px] font-medium rounded border border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent)]/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
                    >
                      {lockPwd ? '设置' : '清除'}
                    </button>
                  </div>
                  {lockMsg === 'success' && (
                    <p className="text-[11px] text-[var(--success)]">{s.lockPassword ? '锁屏密码已更新' : '密码已清除，锁屏点击即可解锁'}</p>
                  )}
                  {lockMsg === 'error' && (
                    <p className="text-[11px] text-[var(--danger)]">两次密码不一致</p>
                  )}
                  {s.lockPassword && !lockMsg && (
                    <p className="text-[11px] text-[var(--text-muted)]">当前已设置密码（{s.lockPassword.length}位）</p>
                  )}

                  {/* Startup auto-lock toggle */}
                  <label className="flex items-center justify-between cursor-pointer pt-1">
                    <span className="text-[12px] text-[var(--text-secondary)]">启动时自动锁屏</span>
                    <input
                      type="checkbox"
                      checked={s.lockOnStartup}
                      onChange={() => update('lockOnStartup', !s.lockOnStartup)}
                      className="accent-[var(--accent)]"
                    />
                  </label>
                  <p className="text-[10px] text-[var(--text-disabled)]">开启后每次启动软件都会先显示锁屏，需输入密码后才能进入</p>
                </div>
              </div>

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
