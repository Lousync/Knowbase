import { useState, useEffect } from 'react'
import { Trash2, RotateCcw, X, AlertCircle } from 'lucide-react'
import type { RecycleBinItem } from '../../../types'
import { getRecycleBinItems, restoreRecycleBinItem, permanentlyDeleteRecycleBinItem, emptyRecycleBin } from '../../../lib/ipc'

interface Props {
  module: 'blog' | 'knowledge'
  onClose: () => void
  onRestored: () => void
}

const MODULE_LABEL: Record<string, string> = {
  blog: '博文回收站',
  knowledge: '知识回收站'
}

export function RecycleBinPanel({ module, onClose, onRestored }: Props) {
  const [items, setItems] = useState<RecycleBinItem[]>([])
  const [loading, setLoading] = useState(true)

  const loadItems = async () => {
    setLoading(true)
    try {
      const all = await getRecycleBinItems()
      setItems(all.filter(item => item.module === module))
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadItems() }, [module])

  const handleRestore = async (id: string) => {
    try {
      await restoreRecycleBinItem(id)
      await loadItems()
      onRestored()
    } catch (e) { console.error(e) }
  }

  const handlePermanentDelete = async (id: string) => {
    try {
      await permanentlyDeleteRecycleBinItem(id)
      await loadItems()
    } catch (e) { console.error(e) }
  }

  const handleEmptyAll = async () => {
    try {
      await emptyRecycleBin()
      await loadItems()
      onRestored()
    } catch (e) { console.error(e) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg w-[500px] max-h-[520px] shadow-2xl flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border-color)] shrink-0">
          <div className="flex items-center gap-2">
            <Trash2 size={16} className="text-[var(--text-secondary)]" />
            <h3 className="text-[14px] font-medium text-[var(--text-primary)]">{MODULE_LABEL[module]}</h3>
            <span className="text-[11px] text-[var(--text-muted)]">· {items.length} 项</span>
          </div>
          <div className="flex items-center gap-1">
            {items.length > 0 && (
              <button
                onClick={handleEmptyAll}
                className="px-2 py-1 text-[11px] text-[var(--danger)] hover:bg-[#e8112320] rounded transition-colors"
              >
                全部清空
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="border-2 border-[var(--border-color)] border-t-[#007acc] rounded-full w-5 h-5 animate-spin" />
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-[var(--text-muted)]">
              <Trash2 size={36} className="mb-3 opacity-30" />
              <p className="text-[13px]">回收站为空</p>
              <p className="text-[11px] mt-1 text-[var(--text-disabled)]">删除的内容将在 30 天后自动清空</p>
            </div>
          ) : (
            <div>
              <div className="px-5 py-2 border-b border-[var(--border-color)] flex items-start gap-1.5 text-[11px] text-[var(--warning)] bg-[var(--warning-bg)]">
                <AlertCircle size={12} className="shrink-0 mt-0.5" />
                <span>删除的内容将在 30 天后自动清空</span>
              </div>
              {items.map(item => (
                <div
                  key={item.id}
                  className="flex items-center justify-between px-5 py-3 border-b border-[var(--border-color)] hover:bg-[var(--bg-hover)] transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] text-[var(--text-primary)] truncate">{item.title || '无标题'}</p>
                    <p className="text-[10px] text-[var(--text-muted)] mt-0.5">
                      删除于 {item.deletedAt?.slice(0, 10)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0 ml-3">
                    <button
                      onClick={() => handleRestore(item.id)}
                      className="p-1.5 rounded text-[var(--accent)] hover:bg-[#007acc20] transition-colors"
                      title="恢复"
                    >
                      <RotateCcw size={15} />
                    </button>
                    <button
                      onClick={() => handlePermanentDelete(item.id)}
                      className="p-1.5 rounded text-[var(--text-secondary)] hover:text-[var(--danger)] hover:bg-[#e8112320] transition-colors"
                      title="永久删除"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
