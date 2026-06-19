import { useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { clearAllData, reloadWindow } from '../../../lib/ipc'
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
            className="px-4 py-1.5 text-[12px] font-semibold bg-[var(--danger)] text-white rounded hover:brightness-110 transition-all"
          >
            清空全部数据
          </button>
        </div>
      </div>

      {/* Two-step modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={close}>
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
                    <p className="text-[13px] text-[var(--text-primary)] leading-relaxed">
                      此操作将<strong className="text-[var(--danger)]">永久删除</strong>以下全部数据：
                    </p>
                    <ul className="mt-2 space-y-1 text-[12px] text-[var(--text-secondary)] list-disc list-inside">
                      <li>所有博客文章及其标签</li>
                      <li>所有日程待办事项</li>
                      <li>所有知识库页面、分类、标签</li>
                      <li>所有回收站内容</li>
                      <li>所有工具箱脚本</li>
                      <li>用户信息与头像</li>
                      <li>所有偏好设置（恢复默认）</li>
                    </ul>
                  </div>

                  <div className="bg-[var(--warning)]/10 border border-[var(--warning)]/30 rounded-lg p-3 flex items-start gap-2">
                    <AlertTriangle size={15} className="text-[var(--warning)] shrink-0 mt-0.5" />
                    <div className="text-[12px] text-[var(--text-primary)] leading-relaxed">
                      <p className="font-semibold text-[var(--warning)] mb-1">建议先导出备份</p>
                      <p>请在操作前通过「导出」模块备份全部数据，清空后<strong>无法恢复</strong>。</p>
                    </div>
                  </div>

                  <div className="flex gap-2 pt-2">
                    <button onClick={close} className="flex-1 py-2 text-[13px] border border-[var(--border-color)] rounded-md hover:bg-[var(--bg-hover)] transition-colors">
                      取消
                    </button>
                    <button
                      onClick={() => setStep(2)}
                      className="flex-1 py-2 text-[13px] font-semibold bg-[var(--danger)] text-white rounded-md hover:brightness-110 transition-all"
                    >
                      我已知晓，继续
                    </button>
                  </div>
                </div>
              ) : (
                /* Step 2: Type confirmation phrase */
                <div className="space-y-4">
                  <p className="text-[13px] text-[var(--text-primary)] leading-relaxed">
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
                    <p className="text-[11px] text-[var(--text-muted)]">请完整输入上方短语，一字不差</p>
                  )}

                  <div className="flex gap-2 pt-1">
                    <button onClick={() => { setStep(1); setInput('') }} className="flex-1 py-2 text-[13px] border border-[var(--border-color)] rounded-md hover:bg-[var(--bg-hover)] transition-colors" disabled={clearing}>
                      上一步
                    </button>
                    <button
                      onClick={handleClear}
                      disabled={input.trim() !== CONFIRM_PHRASE || clearing}
                      className="flex-1 py-2 text-[13px] font-semibold bg-[var(--danger)] text-white rounded-md hover:brightness-110 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
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
