import { useState, useEffect } from 'react'
import * as LucideIcons from 'lucide-react'
import { loadHelpDocs, type HelpDoc } from './docsLoader'
import { MarkdownPreview } from '../../components/shared/MarkdownPreview'

// Module-level target for cross-component navigation (toast "查看详情" etc.)
let pendingDocId: string | null = null

export function navigateToHelp(docId: string) {
  pendingDocId = docId
  window.dispatchEvent(new CustomEvent('help:open'))
}

/** Group docs by category, preserving order */
function groupByCategory(docs: HelpDoc[]): Map<string, HelpDoc[]> {
  const map = new Map<string, HelpDoc[]>()
  for (const d of docs) {
    if (!map.has(d.category)) map.set(d.category, [])
    map.get(d.category)!.push(d)
  }
  return map
}

/** Resolve lucide icon by name string */
function Icon({ name, size = 14 }: { name: string; size?: number }) {
  const icons = LucideIcons as unknown as Record<string, React.ComponentType<{ size?: number }>>
  const C = icons[name]
  return C ? <C size={size} /> : null
}

export function HelpModule() {
  const [docs, setDocs] = useState<HelpDoc[]>([])
  const [activeDoc, setActiveDoc] = useState<string>('shortcuts')

  useEffect(() => {
    loadHelpDocs().then(docs => {
      setDocs(docs)
      const target = pendingDocId
      if (target && docs.some(d => d.id === target)) {
        setActiveDoc(target)
      }
      pendingDocId = null
    })
  }, [])

  const categories = groupByCategory(docs)
  const activeEntry = docs.find(d => d.id === activeDoc)

  return (
    <div className="flex h-full bg-[var(--bg-primary)]">
      {/* Left nav */}
      <div className="w-48 shrink-0 bg-[var(--bg-secondary)] border-r border-[var(--border-color)] py-4 flex flex-col">
        <div className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wide px-4 mb-2">
          帮助
        </div>

        {[...categories.entries()].map(([cat, catDocs]) => (
          <div key={cat} className="mb-3">
            <div className="text-[10px] font-semibold text-[var(--text-disabled)] uppercase tracking-wide px-4 mb-1">
              {cat}
            </div>
            {catDocs.map(d => (
              <button
                key={d.id}
                onClick={() => setActiveDoc(d.id)}
                className={`w-full flex items-center gap-2 px-4 py-1.5 text-[13px] transition-colors ${
                  activeDoc === d.id
                    ? 'bg-[var(--bg-selected)] text-[var(--text-primary)] border-l-2 border-l-[var(--accent)] pl-[14px]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] border-l-2 border-l-transparent pl-[14px]'
                }`}
              >
                <span className={activeDoc === d.id ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}>
                  <Icon name={d.icon} size={14} />
                </span>
                {d.title}
              </button>
            ))}
          </div>
        ))}
      </div>

      {/* Right content */}
      <div className="flex-1 overflow-y-auto py-8">
        <div className="max-w-2xl mx-auto px-8">
          {activeEntry && (
            <>
              <h2 className="text-[16px] font-semibold text-[var(--text-primary)] mb-1">
                {activeEntry.title}
              </h2>
              <p className="text-[12px] text-[var(--text-muted)] mb-8">{activeEntry.category}</p>
              <MarkdownPreview content={activeEntry.md} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
