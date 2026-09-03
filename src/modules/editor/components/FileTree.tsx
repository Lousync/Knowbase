import { useState } from 'react'
import { ChevronRight, ChevronDown, Folder, FolderOpen } from 'lucide-react'
import type { DirCache, TreeNode } from '../types'
import { getFileIcon } from '../../../lib/fileIcons'

interface Props {
  dirCache: DirCache
  expanded: Set<string>
  activePath: string | null
  onToggleDir: (relPath: string) => void
  onOpenFile: (node: TreeNode) => void
  onContextMenu: (e: React.MouseEvent, node: TreeNode) => void
  onMove: (srcRel: string, targetDirRel: string) => void
}

const DRAG_MIME = 'text/x-kb-rel'

function FileIcon({ name }: { name: string }) {
  // 复用 src/lib/fileIcons 知识库已建好的 vscode-icons 库（CC BY 4.0）；
  // 按扩展名映射 27 种文件类型，未命中走 default.svg。无扩展名（新建知识页）默认 md。
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''
  const svg = getFileIcon(ext)
  return (
    <span
      className="shrink-0 inline-flex items-center justify-center"
      style={{ width: 14, height: 14 }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}

/**
 * 目录树：懒加载 + 拖拽移动。
 * 拖拽：条目均可拖（mime: text/x-kb-rel）；目录与根容器是落点，
 * drop 时把源相对路径移动到目标目录下（主进程 ws:rename 跨目录移动）。
 */
export function FileTree({ dirCache, expanded, activePath, onToggleDir, onOpenFile, onContextMenu, onMove }: Props) {
  const [dragOver, setDragOver] = useState<string | null>(null)

  const startDrag = (e: React.DragEvent, relPath: string) => {
    e.dataTransfer.setData(DRAG_MIME, relPath)
    e.dataTransfer.effectAllowed = 'move'
  }

  const dropToDir = (e: React.DragEvent, dirRel: string) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(null)
    const src = e.dataTransfer.getData(DRAG_MIME)
    if (src && src !== dirRel) onMove(src, dirRel)
  }

  const renderDir = (relPath: string, depth: number): React.ReactNode => {
    const entries = dirCache[relPath] ?? []
    const isOpen = expanded.has(relPath)
    const dirNode = relPath === '' ? null : {
      name: relPath.split('/').pop() || relPath,
      type: 'dir' as const,
      size: 0,
      mtime: 0,
      relPath,
    }
    return (
      <div key={relPath}>
        {dirNode && (
          <div
            draggable
            onDragStart={(e) => startDrag(e, relPath)}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(relPath) }}
            onDragLeave={() => setDragOver((p) => (p === relPath ? null : p))}
            onDrop={(e) => dropToDir(e, relPath)}
            className={`group flex items-center gap-1 rounded-md px-1.5 py-[3px] cursor-pointer select-none hover:bg-[var(--bg-hover)] ${
              dragOver === relPath ? 'bg-[var(--accent)]/15 ring-1 ring-inset ring-[var(--accent)]/40' : ''
            }`}
            style={{ paddingLeft: 6 + depth * 12 }}
            onClick={() => onToggleDir(relPath)}
            onContextMenu={(e) => onContextMenu(e, dirNode)}
            title={relPath}
          >
            {isOpen ? <ChevronDown size={12} className="shrink-0 text-[var(--text-muted)]" /> : <ChevronRight size={12} className="shrink-0 text-[var(--text-muted)]" />}
            {isOpen ? <FolderOpen size={14} className="shrink-0 text-[var(--text-muted)]" /> : <Folder size={14} className="shrink-0 text-[var(--text-muted)]" />}
            <span className="truncate text-[12.5px] text-[var(--text-primary)]">{dirNode.name}</span>
          </div>
        )}
        {isOpen && entries.map((e) =>
          e.type === 'dir'
            ? renderDir(e.relPath, depth + 1)
            : (
              <div
                key={e.relPath}
                draggable
                onDragStart={(ev) => startDrag(ev, e.relPath)}
                className={`group flex items-center gap-1 rounded-md px-1.5 py-[3px] cursor-pointer select-none hover:bg-[var(--bg-hover)] ${activePath === e.relPath ? 'bg-[var(--bg-selected)]/40' : ''}`}
                style={{ paddingLeft: 6 + (depth + 1) * 12 }}
                onClick={() => onOpenFile(e)}
                onContextMenu={(ev) => onContextMenu(ev, e)}
                title={e.relPath}
              >
                <span className="w-[12px] shrink-0" />
                <FileIcon name={e.name} />
                <span className={`truncate text-[12.5px] ${activePath === e.relPath ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>{e.name}</span>
              </div>
            ),
        )}
      </div>
    )
  }

  return (
    <div
      className={`flex-1 overflow-y-auto px-1.5 py-1 ${dragOver === '' ? 'bg-[var(--accent)]/10' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver('') }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOver(null) }}
      onDrop={(e) => dropToDir(e, '')}
      onContextMenu={(e) => {
        // 空白区右键 → 以工作区根目录打开右键菜单（新建文件/文件夹/知识页）——节点行上的右键已各自处理并阻止冒泡
        if (e.target === e.currentTarget) {
          onContextMenu(e, { name: '工作区', type: 'dir', size: 0, mtime: 0, relPath: '' })
        }
      }}
    >
      {renderDir('', 0)}
    </div>
  )
}
