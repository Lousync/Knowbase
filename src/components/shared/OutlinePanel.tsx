import { FileText, ArrowLeft } from 'lucide-react'

export interface HeadingNode {
  level: number       // 1-6
  text: string
  id: string          // anchor id derived from text
  line: number        // 1-indexed line number in source md
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
      const line = i + 1  // 1-indexed
      const node: HeadingNode = { level, text, id, line, children: [] }

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

/** Navigate to a heading — dispatches custom event consumed by PageEditor (editor + preview) */
export function navigateToHeading(line: number, id: string) {
  window.dispatchEvent(new CustomEvent('outline:go-to-heading', { detail: { line, id } }))
}

// ---- render ----
interface OutlinePanelProps {
  pageTitle: string
  headings: HeadingNode[]
  onBackToFile: () => void
}

const LEVEL_STYLE: Record<number, string> = {
  1: 'text-[14px] font-bold text-[var(--text-primary)]',
  2: 'text-[13px] font-semibold text-[var(--text-primary)]',
  3: 'text-[12px] font-medium text-[var(--text-secondary)]',
  4: 'text-[12px] font-normal text-[var(--text-muted)]',
  5: 'text-[11px] font-normal text-[var(--text-disabled)]',
  6: 'text-[11px] font-normal text-[var(--text-disabled)] italic',
}

function HeadingRow({ node, depth = 0 }: { node: HeadingNode; depth: number }) {
  const levelClass = LEVEL_STYLE[node.level] ?? LEVEL_STYLE[3]

  return (
    <>
      <div
        className={`flex items-center gap-1.5 py-0.5 cursor-pointer hover:bg-[var(--bg-hover)] rounded transition-colors ${levelClass}`}
        style={{ paddingLeft: `${depth * 12 + 12}px`, paddingRight: '10px' }}
        onClick={() => navigateToHeading(node.line, node.id)}
      >
        <span className="truncate">{node.text}</span>
      </div>
      {node.children.map(ch => (
        <HeadingRow key={ch.id + ':' + (depth + 1)} node={ch} depth={depth + 1} />
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
      <div className="flex-1 overflow-y-auto overscroll-contain px-1 py-1">
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
