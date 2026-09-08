import { useEffect, useRef, useState } from 'react'
import { ChevronRight, ChevronDown, Folder, FolderOpen } from 'lucide-react'
import type { DirCache, TreeNode, CreateIntent } from '../types'
import { getFileIcon } from '../../../lib/fileIcons'
import ignoreRuleSvg from '../../../assets/ignore.svg?raw'

interface Props {
  dirCache: DirCache
  expanded: Set<string>
  activePath: string | null
  onToggleDir: (relPath: string) => void
  onOpenFile: (node: TreeNode) => void
  onContextMenu: (e: React.MouseEvent, node: TreeNode) => void
  onMove: (srcRel: string, targetDirRel: string) => void
  /** VS Code 式内联创建：非空表示在目标目录的条目末尾显示待命名行 */
  creating?: CreateIntent | null
  onCommitCreate?: (dirRel: string, type: 'file' | 'dir' | 'knowledge', rawName: string) => void
  onCancelCreate?: () => void
  /** 双态模型：已归档知识页的仓库相对路径集合——树中隐藏（编辑器只留目录骨架 + 草稿/非知识文件） */
  hiddenRelPaths?: Set<string>
  /** 草稿页 path 集合：树内命中 .md 文件名旁显示「草稿」徽标（辨识写作中/待归档） */
  draftRelPaths?: Set<string>
  /** 软件生成项名单（根层 .ignore / AI教学 产物根等，ws:listDir 附带）：
   *  命中条目从主列表移到底部「软件文件」折叠节（VS Code 时间线式，默认收起） */
  softNames?: string[]
}

const DRAG_MIME = 'text/x-kb-rel'

function FileIcon({ name }: { name: string }) {
  // .ignore 文件名精确匹配分支（先于 ext 提取；不做 'ignore' 后缀注册——避免 a.ignore 等误命中，§9.3-2）。
  // 复用 src/lib/fileIcons 知识库已建好的 vscode-icons 库（CC BY 4.0）；
  // 按扩展名映射 27 种文件类型，未命中走 default.svg。无扩展名（新建知识页）默认 md。
  const isIgnoreRule = name.toLowerCase() === '.ignore'
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''
  const svg = isIgnoreRule ? ignoreRuleSvg : getFileIcon(ext)
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
export function FileTree({ dirCache, expanded, activePath, onToggleDir, onOpenFile, onContextMenu, onMove, creating, onCommitCreate, onCancelCreate, hiddenRelPaths, draftRelPaths, softNames }: Props) {
  const [dragOver, setDragOver] = useState<string | null>(null)
  // 「软件文件」折叠节开合（默认收起，localStorage 记忆——VS Code 时间线式）
  const [softOpen, setSoftOpen] = useState(() => {
    try { return localStorage.getItem('kb.treeSoftOpen') === '1' } catch { return false }
  })
  const toggleSoftOpen = () => {
    setSoftOpen((v) => {
      try { localStorage.setItem('kb.treeSoftOpen', v ? '0' : '1') } catch { /* 隐私模式静默 */ }
      return !v
    })
  }

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

  const renderFileRow = (e: TreeNode, depth: number): React.ReactNode => (
    <div
      key={e.relPath}
      draggable
      onDragStart={(ev) => startDrag(ev, e.relPath)}
      className={`group flex items-center gap-1 rounded-md px-1.5 py-[3px] cursor-pointer select-none hover:bg-[var(--bg-hover)] ${activePath === e.relPath ? 'bg-[var(--bg-selected)]/40' : ''}`}
      style={{ paddingLeft: 6 + depth * 12 }}
      onClick={() => onOpenFile(e)}
      onContextMenu={(ev) => onContextMenu(ev, e)}
      title={e.relPath}
    >
      <span className="w-[12px] shrink-0" />
      <FileIcon name={e.name} />
      <span className={`truncate text-[12.5px] ${activePath === e.relPath ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>{e.name}</span>
      {draftRelPaths?.has(e.relPath) && (
        <span className="ml-auto shrink-0 rounded bg-[var(--warning)]/15 px-1 text-[9px] leading-[14px] text-[var(--warning)]" title="草稿（修改中）— 右键可归档为知识页">草稿</span>
      )}
    </div>
  )

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
      <div key={relPath} className={depth === 0 ? 'flex flex-1 flex-col' : undefined}>
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
        {isOpen && (() => {
          // 软件生成项分组（仅根层）：命中名单的条目移到底部「软件文件」折叠节（VS Code 时间线式）
          const softSet = depth === 0 && softNames?.length ? new Set(softNames) : null
          const main = softSet ? entries.filter((e) => !softSet.has(e.name)) : entries
          const softItems = softSet ? entries.filter((e) => softSet.has(e.name)) : []
          return (
            <>
              {main.map((e) => {
                // 双态模型：已归档知识页在编辑器中隐藏（目录骨架/草稿/代码文件保留）
                if (e.type === 'file' && hiddenRelPaths?.has(e.relPath)) return null
                return e.type === 'dir'
                  ? renderDir(e.relPath, depth + 1)
                  : renderFileRow(e, depth + 1)
              })}
              {softItems.length > 0 && (
                <div className="mt-auto border-t border-[var(--border-color)] pt-1">
                  <div
                    onClick={toggleSoftOpen}
                    className="flex items-center gap-1 rounded-md px-1.5 py-[3px] cursor-pointer select-none hover:bg-[var(--bg-hover)]"
                    style={{ paddingLeft: 6 }}
                    title="软件生成的目录与文件（AI教学 产物、.ignore 过滤规则等）"
                  >
                    {softOpen ? <ChevronDown size={12} className="shrink-0 text-[var(--text-muted)]" /> : <ChevronRight size={12} className="shrink-0 text-[var(--text-muted)]" />}
                    <span className="truncate text-[12px] text-[var(--text-muted)]">软件文件</span>
                    <span className="ml-auto shrink-0 pr-1 text-[10px] text-[var(--text-muted)]">{softItems.length}</span>
                  </div>
                  {softOpen && softItems.map((e) =>
                    e.type === 'dir' ? renderDir(e.relPath, 1) : renderFileRow(e, 1)
                  )}
                </div>
              )}
            </>
          )
        })()}
        {/* VS Code 式内联创建行：目标目录已展开时显示在条目末尾 */}
        {isOpen && creating && creating.dirRel === relPath && (
          <InlineCreateRow
            key={`__create__${creating.type}`}
            depth={depth + 1}
            type={creating.type}
            initial={creating.initial}
            onCommit={(rawName) => onCommitCreate?.(creating.dirRel, creating.type, rawName)}
            onCancel={onCancelCreate ?? (() => {})}
          />
        )}
      </div>
    )
  }

  return (
    <div
      className={`flex flex-1 flex-col overflow-y-auto px-1.5 py-1 ${dragOver === '' ? 'bg-[var(--accent)]/10' : ''}`}
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

/** VS Code 式内联创建行：条目末尾的可编辑输入框。Enter 提交、Esc 取消、失焦取消 */
function InlineCreateRow({ depth, type, initial, onCommit, onCancel }: {
  depth: number
  type: 'file' | 'dir' | 'knowledge'
  initial?: string
  onCommit: (rawName: string) => void
  onCancel: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const committedRef = useRef(false)
  // 默认名：file→"新建文件.md"（保持扩选态方便直接输入主名）; dir→"新目录"; knowledge→空
  const def = type === 'file' ? (initial ?? '新建文件.md') : type === 'dir' ? (initial ?? '新目录') : (initial ?? '')
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.focus()
    if (def) { el.value = def; requestAnimationFrame(() => el.select()) }
  }, [def])
  const commit = () => {
    if (committedRef.current) return
    committedRef.current = true
    onCommit(inputRef.current?.value ?? '')
  }
  const cancel = () => {
    if (committedRef.current) return
    committedRef.current = true
    onCancel()
  }
  return (
    <div
      className="flex items-center gap-1 rounded-md px-1.5 py-[3px]"
      style={{ paddingLeft: 6 + depth * 12 }}
    >
      <span className="w-[12px] shrink-0" />
      {type === 'dir'
        ? <Folder size={14} className="shrink-0 text-[var(--text-muted)]" />
        : <FileIcon name={def || '新建文件.md'} />}
      <input
        ref={inputRef}
        spellCheck={false}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          else if (e.key === 'Escape') cancel()
          e.stopPropagation()
        }}
        onBlur={() => cancel()}
        placeholder={type === 'knowledge' ? '页面标题…' : '名称…'}
        className="min-w-0 flex-1 rounded border border-[var(--accent)] bg-[var(--bg-primary)] px-1 py-[1px] text-[12.5px] text-[var(--text-primary)] outline-none"
      />
    </div>
  )
}
