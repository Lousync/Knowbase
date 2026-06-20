import { FileText, Hash, ArrowLeft } from 'lucide-react'

export interface HeadingNode {
  level: number       // 1-6
  text: string
  id: string          // anchor id derived from text
  children: HeadingNode[]
}

/** Parse markdown content into a heading tree */
export function parseHeadings(md: string): HeadingNode[] {
  const lines = md.split('\n')
  const root: HeadingNode[] = []
  const stack: { level: number; node: HeadingNode }[] = [] // parent chain

  let i = 0
  while (i < lines.length) {
    if (lines[i].startsWith('```') || lines[i].startsWith('~~~')) {
      // Skip fenced code blocks
      const fence = lines[i].match(/^(`{3,}|~{3,})/)![0]
      i++
      while (i < lines.length && !lines[i].startsWith(fence)) i++
      i++
      continue
    }
    const m = lines[i].match(/^(#{1,6})\s+(.+)/)
    if (m) {
      const level = m[1].length
      const text = m[2].trim()
      const id = text
        .toLowerCase()
        .replace(/[^\w一-鿿\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
      const node: HeadingNode = { level, text, id, children: [] }

      // Pop stack to find the correct parent
      while (stack.length > 0 && stack[stack.length - 1].level >= level) {
        stack.pop()
      }
      if (stack.length === 0) {
        root.push(node)
      } else {
        stack[stack.length - 1].node.children.push(node)
      }
      stack.push({ level, node })
    }
    i++
  }
  return root
}

// ---- render ----
interface OutlinePanelProps {
  pageTitle: string
  headings: HeadingNode[]
  onBackToFile: () => void
}

function HeadingRow({ node, depth = 0 }: { node: HeadingNode; depth: number }) {
  return (
    <>
      <div
        className="flex items-center gap-1.5 py-1 cursor-pointer hover:bg-[var(--bg-hover)] rounded text-[13px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        style={{ paddingLeft: `${depth * 14 + 8}px`, paddingRight: '8px' }}
        onClick={() => {
          const el = document.getElementById(node.id)
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }}
      >
        <Hash size={11 + ((6 - node.level) * 1.5)} className="shrink-0 text-[var(--text-muted)]" />
        <span className="truncate">{node.text}</span>
      </div>
      {node.children.map(ch => (
        <HeadingRow key={ch.id + '-' + (depth + 1)} node={ch} depth={depth + 1} />
      ))}
    </>
  )
}

export function OutlinePanel({ pageTitle, headings, onBackToFile }: OutlinePanelProps) {
  return (
    <div className="flex flex-col h-full w-[260px] shrink-0 border-r border-[var(--border-color)] bg-[var(--bg-primary)]">
      {/* Header — back to file view */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border-color)]">
        <button
          onClick={onBackToFile}
          className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors shrink-0"
          title="返回文件视图"
        >
          <ArrowLeft size={16} />
        </button>
        <div className="min-w-0 flex-1">
          <span className="text-[12px] font-medium text-[var(--text-primary)] truncate block">{pageTitle || '无标题'}</span>
          <span className="text-[10px] text-[var(--text-muted)]">{headings.length} 个标题</span>
        </div>
      </div>

      {/* Heading tree */}
      <div className="flex-1 overflow-y-auto px-2 py-1">
        {headings.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-[var(--text-muted)]">
            <FileText size={28} className="mb-2 opacity-25" />
            <p className="text-[11px]">暂无标题</p>
            <p className="text-[10px] mt-1 text-[var(--text-disabled)]">在文档中使用 # 标题语法</p>
          </div>
        ) : (
          headings.map(h => (
            <HeadingRow key={h.id} node={h} depth={0} />
          ))
        )}
      </div>
    </div>
  )
}
