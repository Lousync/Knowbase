import { useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { clearAllData, reloadWindow, workspaceDeleteVault, workspaceGetCurrent } from '../../../lib/ipc'
import { showToast } from '../../../lib/toast'

const CONFIRM_PHRASE = '永久清空全部数据'

export function DataClearSection() {
  const [showModal, setShowModal] = useState(false)
  const [step, setStep] = useState<1 | 2>(1)
  const [input, setInput] = useState('')
  const [clearing, setClearing] = useState(false)

  const open = () => { setStep(1); setInput(''); setShowModal(true) }
  const close = () => { setShowModal(false); setInput('') }

  const handleClear = async () => {
    if (input.trim() !== CONFIRM_PHRASE) return
    setClearing(true)
    const result = await clearAllData()
    if (result.success) {
      showToast({ type: 'info', message: '所有数据已清空，设置已恢复默认。即将重新加载...' })
      setTimeout(() => { reloadWindow() }, 1200)
    } else {
      showToast({ type: 'error', message: result.error || '清空失败' })
      setClearing(false)
      close()
    }
  }

  // P7（D6）：删除当前仓库 = 整仓进 OS 回收站。按定稿不弹提醒窗（回收站即兜底），点击即执行。
  const [deleting, setDeleting] = useState(false)
  const handleDeleteVault = async () => {
    if (deleting) return
    const cur = await workspaceGetCurrent()
    if (!cur) { showToast({ type: 'error', message: '当前没有打开的仓库' }); return }
    setDeleting(true)
    const res = await workspaceDeleteVault(cur.rootId)
    if (res && res.ok) {
      showToast({ type: 'info', message: '仓库已移入系统回收站（可还原）。即将返回仓库选择页...' })
      setTimeout(() => { reloadWindow() }, 1200)
    } else {
      showToast({ type: 'error', message: (res && res.error) || '删除失败' })
      setDeleting(false)
    }
  }

  return (
    <>
      {/* Red danger button */}
      <div className="pt-4 border-t-2 border-[var(--danger)]/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle size={15} className="text-[var(--danger)]" />
            <div>
              <span className="text-[13px] font-semibold text-[var(--danger)]">危险区域</span>
              <p className="text-[10px] text-[var(--text-disabled)]">清空所有数据并恢复默认设置，不可撤销</p>
            </div>
          </div>
          <button
            onClick={open}
            className="px-1.5 py-0.5 rounded-md text-[11.5px] text-[var(--danger)] hover:bg-[var(--bg-hover)] transition-colors"
          >
            清空全部数据
          </button>
        </div>

        {/* 删除当前仓库（P7/D6：整仓进系统回收站，可还原；不弹提醒窗） */}
        <div className="flex items-center justify-between mt-2 pt-2 border-t border-[var(--border-color)]">
          <div>
            <span className="text-[12px] font-medium text-[var(--text-secondary)]">删除当前仓库</span>
            <p className="text-[10px] text-[var(--text-disabled)]">整个仓库文件夹移入系统回收站（可还原），应用返回仓库选择页</p>
          </div>
          <button
            onClick={handleDeleteVault}
            disabled={deleting}
            className="px-1.5 py-0.5 rounded-md text-[11.5px] text-[var(--danger)] hover:bg-[var(--bg-hover)] transition-colors disabled:opacity-40"
          >
            {deleting ? '移入回收站...' : '删除仓库'}
          </button>
        </div>
      </div>

      {/* Two-step modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 kb-overlay" onClick={close}>
          <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl shadow-2xl w-[440px] max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border-color)]">
              <div className="flex items-center gap-2 text-[15px] font-semibold text-[var(--danger)]">
                <AlertTriangle size={17} />
                清空全部数据
              </div>
              <button onClick={close} className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)]" disabled={clearing}>
                <X size={18} />
              </button>
            </div>

            <div className="p-5">
              {step === 1 ? (
                /* Step 1: Warning */
                <div className="space-y-4">
                  <div className="bg-[var(--danger)]/10 border border-[var(--danger)]/30 rounded-lg p-4">
                    <p className="text-[12px] text-[var(--text-primary)] leading-relaxed">
                      此操作将<strong className="text-[var(--danger)]">删除以下全部数据</strong>（仓库文件夹移入系统回收站，其余不可撤销）：
                    </p>
                    <ul className="mt-2 space-y-1 text-[12px] text-[var(--text-secondary)] list-disc list-inside">
                      <li>全部已登记仓库的整个文件夹（内容 + .knowbase 一并进回收站，可在回收站还原）</li>
                      <li>回收站、工具箱脚本、用户信息等残留库数据（直接删除）</li>
                      <li>仓库注册与所有偏好设置（恢复默认，回首启引导）</li>
                    </ul>
                  </div>

                  <div className="bg-[var(--warning)]/10 border border-[var(--warning)]/30 rounded-lg p-3 flex items-start gap-2">
                    <AlertTriangle size={15} className="text-[var(--warning)] shrink-0 mt-0.5" />
                    <div className="text-[12px] text-[var(--text-primary)] leading-relaxed">
                      <p>清空后<strong>无法恢复</strong>，建议先导出备份。</p>
                    </div>
                  </div>

                  <div className="flex gap-2 pt-2">
                    <button onClick={close} className="flex-1 py-1 text-[12px] text-[var(--text-secondary)] border border-[var(--border-color)] rounded-md hover:bg-[var(--bg-hover)] transition-colors">
                      取消
                    </button>
                    <button
                      onClick={() => setStep(2)}
                      className="flex-1 py-1 text-[12px] rounded-md text-[var(--danger)] hover:bg-[var(--bg-hover)] transition-colors"
                    >
                      我已知晓，继续
                    </button>
                  </div>
                </div>
              ) : (
                /* Step 2: Type confirmation phrase */
                <div className="space-y-4">
                  <p className="text-[12px] text-[var(--text-primary)] leading-relaxed">
                    请在下方输入 <code className="px-1.5 py-0.5 bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded text-[var(--danger)] font-mono text-[12px] select-all">{CONFIRM_PHRASE}</code> 以确认操作：
                  </p>

                  <input
                    autoFocus
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && input.trim() === CONFIRM_PHRASE) handleClear() }}
                    placeholder={CONFIRM_PHRASE}
                    className="w-full px-3 py-2.5 bg-[var(--input-bg)] border-2 border-[var(--danger)]/40 focus:border-[var(--danger)] rounded-md text-[14px] font-mono text-[var(--text-primary)] outline-none placeholder:text-[var(--text-disabled)] transition-colors"
                    disabled={clearing}
                  />

                  {input.length > 0 && input.trim() !== CONFIRM_PHRASE && (
                    <p className="text-[11px] text-[var(--text-muted)]">输入上方短语以确认</p>
                  )}

                  <div className="flex gap-2 pt-1">
                    <button onClick={() => { setStep(1); setInput('') }} className="flex-1 py-1 text-[12px] text-[var(--text-secondary)] border border-[var(--border-color)] rounded-md hover:bg-[var(--bg-hover)] transition-colors" disabled={clearing}>
                      上一步
                    </button>
                    <button
                      onClick={handleClear}
                      disabled={input.trim() !== CONFIRM_PHRASE || clearing}
                      className="flex-1 py-1 text-[12px] font-medium bg-[var(--danger)] text-white rounded-md disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      {clearing ? '清空中...' : '确认清空'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
