import { ChevronRight } from 'lucide-react'
import { SECTIONS, type SearchHit, type SettingItem } from '../sections'
import { Highlight, highlightTokens } from '../components/Highlight'

interface Props {
  query: string
  hits: SearchHit[]
  onPick: (item: SettingItem) => void
}

/** 搜索结果面板：按大项分组列出所有命中的小项，点击直达并高亮 */
export function SearchResultsView({ query, hits, onPick }: Props) {
  const tokens = highlightTokens(query)

  const grouped = SECTIONS
    .map(sec => ({ sec, items: hits.filter(h => h.item.section === sec.id) }))
    .filter(g => g.items.length > 0)

  return (
    <div>
      <h2 className="text-[16px] font-semibold text-[var(--text-primary)] mb-1">搜索结果</h2>
      <p className="text-[12px] text-[var(--text-muted)] mb-5">
        “<span className="text-[var(--text-secondary)]">{query}</span>” 命中 {hits.length} 个设置项，点击可直达。
      </p>

      <div className="space-y-6">
        {grouped.map(({ sec, items }) => (
          <div key={sec.id}>
            <div className="flex items-center gap-1.5 mb-2">
              <span className="text-[var(--text-muted)]">{sec.icon}</span>
              <h3 className="text-[12px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide">
                <Highlight text={sec.label} tokens={tokens} />
              </h3>
              <span className="text-[10px] text-[var(--text-disabled)]">({items.length})</span>
            </div>

            <div className="space-y-1">
              {items.map(({ item }) => (
                <button
                  key={item.id}
                  onClick={() => onPick(item)}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] text-left hover:border-[var(--accent)] hover:bg-[var(--bg-hover)] transition-colors group"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-1.5">
                      <span className="text-[13px] text-[var(--text-primary)] truncate">
                        <Highlight text={item.label} tokens={tokens} />
                      </span>
                      <span className="text-[10px] text-[var(--text-muted)] shrink-0">
                        <Highlight text={item.group} tokens={tokens} />
                      </span>
                    </span>
                    {item.desc && (
                      <span className="block text-[11px] text-[var(--text-muted)] truncate mt-0.5">
                        <Highlight text={item.desc} tokens={tokens} />
                      </span>
                    )}
                  </span>
                  <ChevronRight size={14} className="shrink-0 text-[var(--text-disabled)] group-hover:text-[var(--accent)]" />
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
