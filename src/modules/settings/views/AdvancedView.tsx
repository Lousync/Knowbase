import { useState, useEffect } from 'react'
import { RotateCcw } from 'lucide-react'
import { getSetting, setSetting } from '../../../lib/ipc'

export function AdvancedView() {
  const [zoom, setZoom] = useState(1.0)
  const [skipDeleteBlog, setSkipDeleteBlog] = useState(false)
  const [skipDeleteKnowledge, setSkipDeleteKnowledge] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    Promise.all([
      getSetting('zoom'),
      getSetting('skipDeleteConfirm_blog'),
      getSetting('skipDeleteConfirm_knowledge'),
    ]).then(([z, skB, skK]) => {
      if (typeof z === 'number') setZoom(z)
      if (typeof skB === 'boolean') setSkipDeleteBlog(skB)
      if (typeof skK === 'boolean') setSkipDeleteKnowledge(skK)
      setLoaded(true)
    })
  }, [])

  const handleZoomReset = () => {
    setZoom(1.0)
    setSetting('zoom', 1.0)
    document.documentElement.style.fontSize = '16px'
  }

  const handleSkipDeleteBlog = () => {
    const next = !skipDeleteBlog
    setSkipDeleteBlog(next)
    setSetting('skipDeleteConfirm_blog', next)
  }

  const handleSkipDeleteKnowledge = () => {
    const next = !skipDeleteKnowledge
    setSkipDeleteKnowledge(next)
    setSetting('skipDeleteConfirm_knowledge', next)
  }

  if (!loaded) return null

  return (
    <div>
      <h2 className="text-[16px] font-semibold text-[var(--text-primary)] mb-1">高级</h2>
      <p className="text-[12px] text-[var(--text-muted)] mb-6">其他偏好设置</p>

      {/* Zoom */}
      <div className="mb-8">
        <h3 className="text-[12px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-3">缩放</h3>
        <div className="flex items-center gap-4">
          <span className="text-[13px] text-[var(--text-primary)]">
            当前缩放：{Math.round(zoom * 100)}%
          </span>
          <button
            onClick={handleZoomReset}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-[var(--text-primary)] border border-[var(--border-color)] rounded hover:bg-[var(--bg-hover)] transition-colors"
          >
            <RotateCcw size={12} />
            重置缩放
          </button>
        </div>
      </div>

      {/* Delete confirmation */}
      <div>
        <h3 className="text-[12px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-3">删除确认</h3>
        <div className="space-y-2">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={skipDeleteBlog}
              onChange={handleSkipDeleteBlog}
              className="accent-[var(--accent)]"
            />
            <span className="text-[13px] text-[var(--text-primary)]">跳过博客删除确认对话框</span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={skipDeleteKnowledge}
              onChange={handleSkipDeleteKnowledge}
              className="accent-[var(--accent)]"
            />
            <span className="text-[13px] text-[var(--text-primary)]">跳过知识库删除确认对话框</span>
          </label>
        </div>
      </div>
    </div>
  )
}
