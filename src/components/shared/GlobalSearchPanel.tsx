import { useEffect, useState } from 'react'
import { Search, X } from 'lucide-react'
import { searchKnowledgePages } from '../../lib/ipc'
import type { KnowledgePage } from '../../types'

/**
 * 底部面板 · 全局搜索 v1（R1-W2，docs/rework-workbench-design.md §1）
 * - 仅 Workbench 布局渲染（状态栏上方），Ctrl+` 开合
 * - 搜索源 = knowledge 索引全文（vault 读源下为标题/标签/正文，sqlite 读源为标题/正文匹配）
 * - 命中行 Enter / 点击 → 仓库文件路径交给编辑器模块打开（kb-open-in-editor）
 */
interface Props {
  onClose: () => void
}

export function GlobalSearchPanel({ onClose }: Props) {
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<KnowledgePage[]>([])
  const [busy, setBusy] = useState(false)
  const [searched, setSearched] = useState(false)

  // 防抖搜索（260ms）
  useEffect(() => {
    const s = q.trim()
    setSearched(false)
    if (!s) { setRows([]); setBusy(false); return }
    const t = setTimeout(async () => {
      setBusy(true)
      try {
        const r = await searchKnowledgePages(s)
        setRows(r ?? [])
      } catch {
        setRows([])
      } finally {
        setBusy(false)
        setSearched(true)
      }
    }, 260)
    return () => clearTimeout(t)
  }, [q])

  const open = (p: KnowledgePage) => {
    if (!p.path) return
    window.dispatchEvent(new CustomEvent('kb-open-in-editor', { detail: { relPath: p.path } }))
    onClose()
  }

  return (
    <div className="flex h-[210px] shrink-0 flex-col border-t border-[var(--border-color)] bg-[var(--bg-secondary)]">
      {/* 搜索输入行 */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--border-color)]">
        <Search size={13} className="text-[var(--text-muted)] shrink-0" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); onClose() }
            if (e.key === 'Enter' && rows.length > 0) open(rows[0])
          }}
          placeholder="全局搜索：知识页 标题 / 标签 / 正文…"
          spellCheck={false}
          className="flex-1 bg-transparent outline-none text-[12.5px] text-[var(--text-primary)] placeholder-[var(--text-muted)]"
        />
        <span className="shrink-0 text-[10px] text-[var(--text-disabled)]">{busy ? '搜索中…' : searched ? `${rows.length} 条结果` : q.trim() ? '' : 'Ctrl+` 开关'}</span>
        <button onClick={onClose} title="关闭 (Esc)" className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors">
          <X size={14} />
        </button>
      </div>

      {/* 结果 */}
      <div className="flex-1 overflow-y-auto py-0.5">
        {!q.trim() && (
          <div className="px-3 py-4 text-center text-[11.5px] text-[var(--text-muted)]">
            输入关键词搜索知识页（标题 / 标签 / 正文命中），Enter 打开第一条
          </div>
        )}
        {q.trim() && !busy && rows.length === 0 && (
          <div className="px-3 py-4 text-center text-[11.5px] text-[var(--text-muted)]">
            {searched ? '没有匹配的知识页' : '…'}
          </div>
        )}
        {rows.map((p) => (
          <button
            key={p.id}
            onClick={() => open(p)}
            className="w-full flex flex-col items-start gap-0.5 px-3 py-1.5 text-left hover:bg-[var(--bg-hover)] transition-colors"
          >
            <span className="flex w-full items-baseline gap-2 min-w-0">
              <span className="truncate text-[12.5px] text-[var(--text-primary)]">{p.title || '(无标题)'}</span>
              {p.path && <span className="ml-auto shrink-0 truncate max-w-[45%] text-[10.5px] text-[var(--text-disabled)]">{p.path}</span>}
            </span>
            {p.excerpt ? (
              <span className="line-clamp-1 text-[11px] text-[var(--text-muted)]">{p.excerpt}</span>
            ) : (
              p.categoryId && <span className="text-[11px] text-[var(--text-muted)]">…</span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
