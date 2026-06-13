import { FileText, FileArchive, Database, Loader2 } from 'lucide-react'

// ---- types ----
export interface SelectableItem {
  id: string
  title: string
  subtitle: string
}

interface ModuleSection {
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

// ---- Section component ----
function ModuleSectionView({
  icon, label, items, selectedIds, onToggle, onSelectAll, onDeselectAll, loading, enabled
}: ModuleSection) {
  if (!enabled) return null

  const allSelected = items.length > 0 && selectedIds.size === items.length

  return (
    <div className="mb-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-2 px-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[var(--text-muted)]">{icon}</span>
          <span className="text-[11px] font-semibold text-[var(--text-primary)] uppercase tracking-wide">
            {label}
          </span>
          <span className="text-[10px] text-[var(--text-muted)]">
            ({selectedIds.size}/{items.length})
          </span>
        </div>
        <button
          onClick={allSelected ? onDeselectAll : onSelectAll}
          className="text-[10px] text-[var(--accent)] hover:text-[var(--accent-hover)] transition-colors"
        >
          {allSelected ? '取消全选' : '全选'}
        </button>
      </div>

      {/* Items */}
      <div className="max-h-48 overflow-y-auto">
        {loading ? (
          <div className="flex items-center gap-2 py-3 px-2 text-[11px] text-[var(--text-muted)]">
            <Loader2 size={12} className="animate-spin" />
            加载中...
          </div>
        ) : items.length === 0 ? (
          <div className="py-3 px-2 text-[11px] text-[var(--text-disabled)]">暂无数据</div>
        ) : (
          items.map(item => (
            <label
              key={item.id}
              className="flex items-center gap-2 py-1.5 px-1 cursor-pointer transition-colors hover:bg-[var(--bg-hover)] rounded"
            >
              <input
                type="checkbox"
                checked={selectedIds.has(item.id)}
                onChange={() => onToggle(item.id)}
                className="accent-[var(--accent)] shrink-0"
              />
              <div className="min-w-0 flex-1">
                <div className="text-[12px] text-[var(--text-primary)] truncate">{item.title || '无标题'}</div>
                <div className="text-[10px] text-[var(--text-muted)] truncate">{item.subtitle}</div>
              </div>
            </label>
          ))
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

      <ModuleSectionView
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

      <ModuleSectionView
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

      <ModuleSectionView
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
