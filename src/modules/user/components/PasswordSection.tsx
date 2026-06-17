import { useState } from 'react'
import { Lock, X } from 'lucide-react'
import { setUserPassword, changeUserPassword, clearUserPassword, hasUserPassword } from '../../../lib/ipc'
import { showToast } from '../../../lib/toast'

interface Props {
  hasPassword: boolean
  onPasswordChanged: (hasPwd: boolean) => void
}

export function PasswordSection({ hasPassword, onPasswordChanged }: Props) {
  const [showModal, setShowModal] = useState(false)
  const [mode, setMode] = useState<'set' | 'change' | 'clear'>('set')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const openModal = (m: 'set' | 'change' | 'clear') => {
    setMode(m)
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setShowModal(true)
  }

  const handleSubmit = async () => {
    if (mode === 'set' || mode === 'change') {
      if (!newPassword) { showToast({ type: 'warning', message: '请输入新密码' }); return }
      if (newPassword !== confirmPassword) { showToast({ type: 'warning', message: '两次密码不一致' }); return }

      if (mode === 'set') {
        await setUserPassword(newPassword)
        showToast({ type: 'info', message: '密码已设置' })
        onPasswordChanged(true)
      } else {
        if (!currentPassword) { showToast({ type: 'warning', message: '请输入当前密码' }); return }
        const result = await changeUserPassword(currentPassword, newPassword)
        if (!result.success) { showToast({ type: 'error', message: result.error || '密码修改失败' }); return }
        showToast({ type: 'info', message: '密码已修改' })
        onPasswordChanged(true)
      }
    } else if (mode === 'clear') {
      if (!currentPassword) { showToast({ type: 'warning', message: '请输入当前密码' }); return }
      const result = await clearUserPassword(currentPassword)
      if (!result.success) { showToast({ type: 'error', message: result.error || '密码错误' }); return }
      showToast({ type: 'info', message: '密码已清除' })
      onPasswordChanged(false)
    }

    setShowModal(false)
  }

  const buttonLabel = hasPassword ? '修改密码' : '设置密码'
  const buttonClass = hasPassword
    ? 'px-4 py-1.5 text-[12px] border border-[var(--border-color)] rounded hover:bg-[var(--bg-hover)] transition-colors'
    : 'px-4 py-1.5 text-[12px] bg-[var(--accent)] text-white rounded hover:bg-[var(--accent-hover)] transition-colors'

  return (
    <>
      <div className="flex items-center gap-2">
        <Lock size={14} className="text-[var(--text-muted)]" />
        <span className="text-[13px] text-[var(--text-secondary)]">
          {hasPassword ? '••••••' : '未设置密码'}
        </span>
        <button onClick={() => openModal(hasPassword ? 'change' : 'set')} className={buttonClass}>
          {buttonLabel}
        </button>
        {hasPassword && (
          <button onClick={() => openModal('clear')}
            className="px-4 py-1.5 text-[12px] text-[var(--text-muted)] hover:text-[var(--danger)] transition-colors"
          >
            清除密码
          </button>
        )}
      </div>

      {/* Password modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowModal(false)}>
          <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl shadow-2xl w-[360px]" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border-color)]">
              <div className="flex items-center gap-2 text-[14px] font-semibold text-[var(--text-primary)]">
                <Lock size={15} className="text-[var(--text-muted)]" />
                {mode === 'set' ? '设置密码' : mode === 'change' ? '修改密码' : '清除密码'}
              </div>
              <button onClick={() => setShowModal(false)} className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)]">
                <X size={18} />
              </button>
            </div>
            <div className="p-5 space-y-3 text-[13px]">
              {(mode === 'change' || mode === 'clear') && (
                <input
                  type="password" autoFocus placeholder="当前密码"
                  value={currentPassword} onChange={e => setCurrentPassword(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                  className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--border-color)] rounded text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                />
              )}
              {(mode === 'set' || mode === 'change') && (
                <>
                  <input
                    type="password" autoFocus placeholder="新密码"
                    value={newPassword} onChange={e => setNewPassword(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && (mode === 'set' ? handleSubmit() : undefined)}
                    className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--border-color)] rounded text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                  />
                  <input
                    type="password" placeholder="确认新密码"
                    value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                    className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--border-color)] rounded text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                  />
                </>
              )}
              {mode === 'clear' && (
                <p className="text-[var(--text-secondary)]">清除密码后，导入数据包将不再需要密码验证。</p>
              )}
              <div className="flex gap-2 pt-1">
                <button onClick={handleSubmit}
                  className={`flex-1 py-2 text-[13px] rounded transition-colors ${
                    mode === 'clear' ? 'bg-[var(--danger)] text-white hover:brightness-110' : 'bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]'
                  }`}
                >
                  {mode === 'set' ? '设置' : mode === 'change' ? '修改' : '确认清除'}
                </button>
                <button onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-[13px] border border-[var(--border-color)] rounded hover:bg-[var(--bg-hover)] transition-colors"
                >
                  取消
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
