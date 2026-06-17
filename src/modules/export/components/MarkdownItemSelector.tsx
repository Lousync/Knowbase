import { useState } from 'react'
import { FileText, FileArchive, Database, Loader2, ChevronRight, ChevronDown, Folder, BookOpen, File } from 'lucide-react'

// ---- types ----
export interface SelectableItem {
  id: string
  title: string
  subtitle: string
  depth?: number
  children?: SelectableItem[]
  isGroup?: boolean  // true = group header (not selectable), false = leaf (selectable)
}

interface MarkdownItemSelectorProps {
  blogItems: SelectableItem[]
  selectedBlogIds: Set<string>
  onBlogToggle: (id: string) => void
  onBlogSelectAll: () => void
  onBlogDeselectAll: () => void
  blogLoading: boolean

  knowledgeItems: SelectableItem[]
  selectedKnowledgeIds: Set<string>
  onKnowledgeToggle: (id: string) => void
  onKnowledgeSelectAll: () => void
  onKnowledgeDeselectAll: () => void
  knowledgeLoading: boolean

  scheduleItems: SelectableItem[]
  selectedScheduleIds: Set<string>
  onScheduleToggle: (id: string) => void
  onScheduleSelectAll: () => void
  onScheduleDeselectAll: () => void
  scheduleLoading: boolean

  enabledModules: Set<string>
}

// ---- Helpers for tree data ----
function countLeaves(items: SelectableItem[]): number {
  let n = 0
  for (const it of items) {
    if (it.children?.length) n += countLeaves(it.children)
    else if (!it.isGroup) n++
  }
  return n
}

function collectLeafIds(items: SelectableItem[]): Set<string> {
  const ids = new Set<string>()
  for (const it of items) {
    if (it.children?.length) {
      for (const id of collectLeafIds(it.children)) ids.add(id)
    } else if (!it.isGroup) {
      ids.add(it.id)
    }
  }
  return ids
}

// ---- Tree section component ----
interface TreeModuleSectionProps {
  icon: React.ReactNode
  label: string
  items: SelectableItem[]
  selectedIds: Set<string>
  onToggle: (id: string) => void
  onSelectAll: () => void
  onDeselectAll: () => void
  loading: boolean
  enabled: boolean
}

function ModuleTreeSectionView({
  icon, label, items, selectedIds, onToggle, onSelectAll, onDeselectAll, loading, enabled
}: TreeModuleSectionProps) {
  if (!enabled) return null

  const totalLeaves = countLeaves(items)
  const selectedLeaves = [...collectLeafIds(items)].filter(id => selectedIds.has(id)).length
  const allSelected = totalLeaves > 0 && selectedLeaves === totalLeaves

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  function toggleCollapse(id: string) {
    setCollapsed(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }

  function renderNode(item: SelectableItem, depth: number): React.ReactNode {
    const hasChildren = item.children && item.children.length > 0
    const isCollapsed = collapsed.has(item.id)

    return (
      <div key={item.id}>
        <div
          className={`flex items-center gap-1.5 py-1.5 px-1 cursor-pointer transition-colors hover:bg-[var(--bg-hover)] rounded`}
          style={{ paddingLeft: `${depth * 16 + 4}px` }}
          onClick={() => {
            if (hasChildren) toggleCollapse(item.id)
            else if (!item.isGroup) onToggle(item.id)
          }}
        >
          {hasChildren ? (
            isCollapsed ? <ChevronRight size={12} className="text-[var(--text-muted)] shrink-0" /> : <ChevronDown size={12} className="text-[var(--text-muted)] shrink-0" />
          ) : (
            <span className="w-3 shrink-0" />
          )}
          <span className="text-[var(--text-muted)] shrink-0">
            {item.isGroup && hasChildren ? (isCollapsed ? <Folder size={13} /> : <Folder size={13} />) : item.isGroup ? <BookOpen size={13} /> : <File size={13} />}
          </span>
          {item.isGroup || hasChildren ? (
            <span className="text-[12px] text-[var(--text-primary)] truncate flex-1">{item.title}</span>
          ) : (
            <label className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer" onClick={e => e.stopPropagation()}>
              <input
                type="checkbox"
                checked={selectedIds.has(item.id)}
                onChange={() => onToggle(item.id)}
                className="accent-[var(--accent)] shrink-0"
              />
              <span className="text-[12px] text-[var(--text-primary)] truncate">{item.title || '无标题'}</span>
            </label>
          )}
        </div>
        {hasChildren && !isCollapsed && (
          <div>{item.children!.map(ch => renderNode(ch, depth + 1))}</div>
        )}
      </div>
    )
  }

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-2 px-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[var(--text-muted)]">{icon}</span>
          <span className="text-[11px] font-semibold text-[var(--text-primary)] uppercase tracking-wide">{label}</span>
          <span className="text-[10px] text-[var(--text-muted)]">({selectedLeaves}/{totalLeaves})</span>
        </div>
        <button
          onClick={allSelected ? onDeselectAll : onSelectAll}
          className="text-[10px] text-[var(--accent)] hover:text-[var(--accent-hover)] transition-colors"
        >{allSelected ? '取消全选' : '全选'}</button>
      </div>
      <div className="max-h-48 overflow-y-auto">
        {loading ? (
          <div className="flex items-center gap-2 py-3 px-2 text-[11px] text-[var(--text-muted)]">
            <Loader2 size={12} className="animate-spin" />
            加载中...
          </div>
        ) : items.length === 0 ? (
          <div className="py-3 px-2 text-[11px] text-[var(--text-disabled)]">暂无数据</div>
        ) : (
          items.map(item => renderNode(item, 0))
        )}
      </div>
    </div>
  )
}

// ---- Main component ----
export function MarkdownItemSelector(props: MarkdownItemSelectorProps) {
  return (
    <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg p-4 w-full">
      <div className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-3">
        选择导出条目
      </div>

      <ModuleTreeSectionView
        icon={<FileText size={14} />}
        label="博客文章"
        items={props.blogItems}
        selectedIds={props.selectedBlogIds}
        onToggle={props.onBlogToggle}
        onSelectAll={props.onBlogSelectAll}
        onDeselectAll={props.onBlogDeselectAll}
        loading={props.blogLoading}
        enabled={props.enabledModules.has('blog')}
      />

      <ModuleTreeSectionView
        icon={<FileArchive size={14} />}
        label="知识库页面"
        items={props.knowledgeItems}
        selectedIds={props.selectedKnowledgeIds}
        onToggle={props.onKnowledgeToggle}
        onSelectAll={props.onKnowledgeSelectAll}
        onDeselectAll={props.onKnowledgeDeselectAll}
        loading={props.knowledgeLoading}
        enabled={props.enabledModules.has('knowledge')}
      />

      <ModuleTreeSectionView
        icon={<Database size={14} />}
        label="日程待办"
        items={props.scheduleItems}
        selectedIds={props.selectedScheduleIds}
        onToggle={props.onScheduleToggle}
        onSelectAll={props.onScheduleSelectAll}
        onDeselectAll={props.onScheduleDeselectAll}
        loading={props.scheduleLoading}
        enabled={props.enabledModules.has('schedule')}
      />
    </div>
  )
}
