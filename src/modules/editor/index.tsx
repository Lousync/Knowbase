import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  FolderOpen, Plus, FolderPlus, Save, SaveAll, X, Folder, FileText,
  Pencil, Trash2, ChevronRight, FilePlus2, Braces, BookOpen, ListTree, Eye, PanelRightClose, Archive, FilePenLine,
} from 'lucide-react'
import type { WorkspaceRecent } from '../../types'
import {
  workspaceOpenDir, workspaceOpenById, workspaceListDir, workspaceReadFile, workspaceWriteFile,
  workspaceCreateFile, workspaceMkdir, workspaceRename, workspaceTrash, workspaceGetRecent,
  workspaceGetCurrent, workspaceSetMdStatus, getKnowledgePages,
} from '../../lib/ipc'
import { showToast } from '../../lib/toast'
import { FileTree } from './components/FileTree'
import { MonacoPane, type MonacoPaneHandle } from './components/MonacoPane'
import { PdfReaderView } from './components/PdfReaderView'
import { extractOutline } from '../../lib/markdownOutline'
import type { EditorDoc, DirCache, TreeNode, CreateIntent } from './types'
import { joinRel, parentRel, baseName, languageFor, splitFrontmatter, joinFrontmatter, fullContent, savedFullContent } from './types'
import { ConfirmDialog } from '../../components/shared'
import { MarkdownPreview } from '../../components/shared/MarkdownPreview'

interface Props {
  isActive?: boolean
  /** Workbench 外壳（R1-W1）：全局侧栏容器节点。传入时文件树 portal 到该节点、内嵌列收起；null/缺省 = 模块内嵌布局 */
  sidebarEl?: HTMLElement | null
  /** Markdown 标记淡化（设置 markdownDim 透传；默认开） */
  markdownDim?: boolean
}

interface InputBoxState {
  title: string
  placeholder: string
  initial: string
  submitLabel: string
  onSubmit: (value: string) => void
}

export function EditorModule({ isActive = true, sidebarEl = null, markdownDim = true }: Props) {
  const [rootId, setRootId] = useState<string | null>(null)
  const [rootName, setRootName] = useState('')
  const [recent, setRecent] = useState<WorkspaceRecent[]>([])
  const [dirCache, setDirCache] = useState<DirCache>({})
  /** R5：分栏预览开关（左侧 Monaco 编辑 / 右侧 MarkdownPreview 实时渲染），localStorage 记忆 */
  const [previewOpen, setPreviewOpen] = useState<boolean>(() => {
    try { return localStorage.getItem('kb.editor.previewOpen') === '1' } catch { return false }
  })
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [openFiles, setOpenFiles] = useState<Record<string, EditorDoc>>({})
  const [activePath, setActivePath] = useState<string | null>(null)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; node: TreeNode } | null>(null)
  const [trashTarget, setTrashTarget] = useState<TreeNode | null>(null)
  const [inputBox, setInputBox] = useState<InputBoxState | null>(null)
  const [inputValue, setInputValue] = useState('')
  /** VS Code 式内联创建意图（非空=文件树目标目录尾部显示命名行） */
  const [creating, setCreating] = useState<CreateIntent | null>(null)
  /** 双态模型：已归档（published）知识页 path 集合——编辑器树隐藏它们（树只留目录+草稿/非知识文件） */
  const [archivedPaths, setArchivedPaths] = useState<Set<string>>(new Set())
  /** tab 右键（状态动作/关闭） */
  const [tabCtx, setTabCtx] = useState<{ x: number; y: number; rel: string } | null>(null)
  const [closeTarget, setCloseTarget] = useState<string | null>(null)
  /** 保存冲突（磁盘被外部修改）：弹三选对话框 */
  const [conflictState, setConflictState] = useState<{ relPath: string; diskMtimeMs?: number; missing: boolean } | null>(null)
  /** frontmatter 查看/编辑弹窗（frontmatter 前缀文本，含 --- 包裹） */
  const [fmDraft, setFmDraft] = useState<{ relPath: string; text: string } | null>(null)
  const [fmText, setFmText] = useState('')
  /** 回跳知识库前存在未保存修改：确认是否先保存（不保存则知识库读到磁盘旧内容） */
  const [kbReadTarget, setKbReadTarget] = useState<string | null>(null)
  /** 大纲面板开关 */
  const [outlineOpen, setOutlineOpen] = useState(false)
  const monacoRef = useRef<MonacoPaneHandle | null>(null)
  const rootIdRef = useRef<string | null>(null)
  const openFilesRef = useRef(openFiles)
  const activePathRef = useRef(activePath)

  useEffect(() => { rootIdRef.current = rootId }, [rootId])
  useEffect(() => { openFilesRef.current = openFiles }, [openFiles])
  useEffect(() => { activePathRef.current = activePath }, [activePath])
  useEffect(() => { if (inputBox) setInputValue(inputBox.initial) }, [inputBox])

  // 回收策略：仅「脏(未保存)文档」长期驻留 openFiles + 标签栏；
  // 干净文档只作为当前预览存在——切走即从 openFiles 移除（无修改，丢弃安全，重开再读盘）。
  const isDirtyDoc = (d: EditorDoc): boolean => fullContent(d) !== savedFullContent(d)
  const pruneCleanNonActive = useCallback((activeRel: string | null) => {
    setOpenFiles((prev) => {
      const entries = Object.entries(prev)
      if (entries.every(([rel, d]) => rel === activeRel || isDirtyDoc(d))) return prev
      const next: Record<string, EditorDoc> = {}
      for (const [rel, d] of entries) {
        if (rel === activeRel || isDirtyDoc(d)) next[rel] = d
      }
      return next
    })
  }, [])

  // activePath 切换后回收：切走的干净文档不留驻（脏文档保留）
  useEffect(() => {
    pruneCleanNonActive(activePath)
  }, [activePath, pruneCleanNonActive])

  useEffect(() => {
    workspaceGetRecent().then(setRecent).catch(() => {})
  }, [])

  const dirtyCount = Object.values(openFiles).filter((d) => isDirtyDoc(d)).length

  const refreshDir = useCallback(async (dirRel: string) => {
    const root = rootIdRef.current
    if (!root) return
    const res = await workspaceListDir(root, dirRel)
    if (res.error) { showToast({ type: 'error', message: res.error }); return }
    const nodes: TreeNode[] = (res.entries ?? []).map((e) => ({ ...e, relPath: joinRel(dirRel, e.name) }))
    setDirCache((prev) => ({ ...prev, [dirRel]: nodes }))
  }, [])

  const enterWorkspace = useCallback(async (rid: string, name: string) => {
    rootIdRef.current = rid
    setRootId(rid)
    setRootName(name)
    setDirCache({})
    setExpanded(new Set())
    setOpenFiles({})
    setActivePath(null)
    await refreshDir('')
    setExpanded((prev) => new Set(prev).add(''))
    // Workbench 状态栏仓库上下文联动
    window.dispatchEvent(new CustomEvent('wb-repo-changed'))
  }, [refreshDir])

  // 读写分工：编辑器 = 当前仓库的唯一写入方 → 挂载即自动挂载当前仓库（首次引导已选过，免二次选择）
  useEffect(() => {
    workspaceGetCurrent()
      .then((cur) => { if (cur?.rootId) void enterWorkspace(cur.rootId, cur.name ?? '') })
      .catch(() => {})
  }, [enterWorkspace])

  const handleOpenDir = useCallback(async () => {
    const res = await workspaceOpenDir()
    if (!res) return
    if (res.error) { showToast({ type: 'error', message: res.error }); return }
    await enterWorkspace(res.rootId, res.name)
    workspaceGetRecent().then(setRecent).catch(() => {})
  }, [enterWorkspace])

  const handleOpenRecent = useCallback(async (r: WorkspaceRecent) => {
    const res = await workspaceOpenById(r.rootId)
    if (res.error) { showToast({ type: 'error', message: res.error || '无法打开该仓库' }); return }
    await enterWorkspace(res.rootId, res.name)
  }, [enterWorkspace])

  const toggleDir = useCallback(async (relPath: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(relPath)) { next.delete(relPath); return next }
      next.add(relPath)
      return next
    })
    await refreshDir(relPath)
  }, [refreshDir])

  const openFile = useCallback(async (node: TreeNode) => {
    if (node.type === 'dir') { void toggleDir(node.relPath); return }
    const root = rootIdRef.current
    if (!root) return
    setActivePath(node.relPath)
    if (openFilesRef.current[node.relPath]) return
    const res = await workspaceReadFile(root, node.relPath)
    if (res.error) { showToast({ type: 'error', message: res.error }); return }
    const language = languageFor(node.name)
    // PDF 文档类型（P1）：不按文本读——内容置空、binary 标记、路由 PdfReaderView 懒加载渲染。
    // 判定用主进程 %PDF- 头探测（res.pdf）而非仅扩展名：知识库旧附件是无扩展名的 PDF
    const isPdf = res.pdf === true || /\.pdf$/i.test(node.name)
    // frontmatter 隐藏：markdown 文档拆分前缀，Monaco 只见正文（保存时拼回，roundtrip 无损）
    const fm = !isPdf && res.editable && language === 'markdown' && !res.binary ? splitFrontmatter(res.content) : null
    setOpenFiles((prev) => ({
      ...prev,
      [node.relPath]: {
        relPath: node.relPath,
        content: isPdf ? '' : (fm ? fm.body : res.content),
        savedContent: isPdf ? '' : (fm ? fm.body : res.content),
        binary: isPdf || res.binary,
        editable: res.editable,
        truncated: res.truncated,
        size: res.size,
        language: isPdf ? 'pdf' : language,
        lastSavedAt: Date.now(),
        mtimeMs: res.mtimeMs,
        frontmatterPrefix: fm ? fm.prefix : undefined,
        savedPrefix: fm ? fm.prefix : undefined,
      },
    }))
  }, [toggleDir])

  // ---- R5 分栏预览 ----
  /** 切换预览并记忆到 localStorage（下次打开编辑器保持上次状态） */
  const togglePreview = useCallback(() => {
    setPreviewOpen((v) => {
      const next = !v
      try { localStorage.setItem('kb.editor.previewOpen', next ? '1' : '0') } catch { /* 隐私模式忽略 */ }
      return next
    })
  }, [])

  /** 已缓存目录里出现过的 .md 文件名（去扩展名）——预览里 [[双链]] 是否渲染为「空链接」的依据 */
  const knownWikiTitles = useMemo(() => {
    const s = new Set<string>()
    for (const entries of Object.values(dirCache)) {
      for (const e of entries) {
        if (e.type === 'file' && /\.md$/i.test(e.name)) s.add(e.name.replace(/\.md$/i, ''))
      }
    }
    return s
  }, [dirCache])

  /** 预览里点 [[双链]]：在已加载目录缓存内按文件名命中并打开；未命中提示（目录懒加载，未展开的目录查不到） */
  const handleWikiLink = useCallback((title: string) => {
    const target = `${title.toLowerCase()}.md`
    for (const entries of Object.values(dirCache)) {
      const hit = entries.find((e) => e.type === 'file' && e.name.toLowerCase() === target)
      if (hit) { void openFile(hit); return }
    }
    showToast({ type: 'info', message: `未在当前仓库找到「${title}」（该目录可能未展开）` })
  }, [dirCache, openFile])

  // 跨模块跳转：知识库「在编辑器中打开」→ 打开同一文件（读写分工协议，见 .AGENT/docs/读写分工设计.md）
  const openRelFromJump = useCallback(async (relPath: string) => {
    // 已消费即清暂存（防模块重挂载时误开旧文件）
    delete (window as unknown as { __kbPendingOpenInEditor?: string }).__kbPendingOpenInEditor
    if (!rootIdRef.current) {
      const cur = await workspaceGetCurrent()
      if (cur?.rootId) await enterWorkspace(cur.rootId, cur.name ?? '')
    }
    if (!rootIdRef.current) { showToast({ type: 'warning', message: '尚未打开任何仓库' }); return }
    const name = relPath.split('/').pop() || relPath
    await openFile({ relPath, name, type: 'file' } as TreeNode)
  }, [openFile, enterWorkspace])

  useEffect(() => {
    const handler = async (e: Event) => {
      const relPath = (e as CustomEvent).detail?.relPath as string
      if (!relPath || typeof relPath !== 'string') return
      await openRelFromJump(relPath)
    }
    window.addEventListener('kb-open-in-editor', handler)
    return () => window.removeEventListener('kb-open-in-editor', handler)
  }, [openRelFromJump])

  // 事件丢失竞态修复（首次打开编辑器 Tab 前派发的 kb-open-in-editor 无监听者）：
  // App.tsx 把最近一次待打开路径暂存 window.__kbPendingOpenInEditor；本模块首挂后消费一次
  useEffect(() => {
    const pending = (window as unknown as { __kbPendingOpenInEditor?: string }).__kbPendingOpenInEditor
    if (typeof pending === 'string' && pending) {
      delete (window as unknown as { __kbPendingOpenInEditor?: string }).__kbPendingOpenInEditor
      void openRelFromJump(pending)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleChange = useCallback((relPath: string, value: string) => {
    setOpenFiles((prev) => (prev[relPath] ? { ...prev, [relPath]: { ...prev[relPath], content: value } } : prev))
  }, [])

  /**
   * 保存文档；forceMtimeMs 用于"覆盖磁盘"（以磁盘最新 mtime 为基线强制写）。
   * @returns true=已写入磁盘（或无需保存）；false=未写入（冲突弹窗 / 失败）。
   * 冲突弹窗在编辑器模块内，若切走 Tab 会被 display:none 隐藏——调用方（如回跳知识库）
   * 必须依据返回值决定是否继续，避免冲突未决就切走。
   */
  const saveDoc = useCallback(async (relPath: string, forceMtimeMs?: number): Promise<boolean> => {
    const root = rootIdRef.current
    const doc = openFilesRef.current[relPath]
    if (!root || !doc || fullContent(doc) === savedFullContent(doc)) return true
    // frontmatter 前缀拼回（如曾被编辑），保证磁盘文件完整
    const res = await workspaceWriteFile(root, relPath, joinFrontmatter(doc), forceMtimeMs ?? doc.mtimeMs)
    if (res.ok) {
      setOpenFiles((prev) => (prev[relPath]
        ? {
          ...prev,
          [relPath]: {
            ...prev[relPath],
            savedContent: doc.content,
            savedPrefix: doc.frontmatterPrefix,
            mtimeMs: res.mtimeMs ?? prev[relPath].mtimeMs,
            size: res.size ?? prev[relPath].size,
            lastSavedAt: Date.now(),
          },
        }
        : prev))
      showToast({ type: 'info', message: '已保存' })
      // 保存后该文档不再脏：若非当前激活，回收其驻留（干净文件不长期占 openFiles/标签）
      pruneCleanNonActive(activePathRef.current)
      return true
    }
    if (res.conflict) {
      // 磁盘已被外部修改（或删除）→ 弹三选冲突对话框
      setConflictState({ relPath, diskMtimeMs: res.diskMtimeMs, missing: res.missing === true })
      return false
    }
    showToast({ type: 'error', message: res.error || '保存失败' })
    return false
  }, [])

  /** 冲突解决：放弃本地修改，重新加载磁盘内容 */
  const reloadFromDisk = useCallback(async (relPath: string) => {
    const root = rootIdRef.current
    if (!root) return
    setConflictState(null)
    const res = await workspaceReadFile(root, relPath)
    if (res.error) { showToast({ type: 'error', message: res.error }); return }
    const isPdf = /\.pdf$/i.test(relPath)
    const language = isPdf ? 'pdf' : languageFor(baseName(relPath))
    const fm = !isPdf && res.editable && language === 'markdown' && !res.binary ? splitFrontmatter(res.content) : null
    setOpenFiles((prev) => (prev[relPath]
      ? {
        ...prev,
        [relPath]: {
          ...prev[relPath],
          content: fm ? fm.body : res.content,
          savedContent: fm ? fm.body : res.content,
          savedPrefix: fm ? fm.prefix : undefined,
          frontmatterPrefix: fm ? fm.prefix : undefined,
          mtimeMs: res.mtimeMs,
          size: res.size,
          binary: res.binary,
          editable: res.editable,
          truncated: res.truncated,
          lastSavedAt: Date.now(),
        },
      }
      : prev))
    showToast({ type: 'info', message: '已重新加载磁盘内容' })
  }, [])

  /** 冲突解决：保留本地修改，覆盖磁盘（用磁盘最新 mtime 作基线强制写） */
  const overwriteDisk = useCallback(async (relPath: string, diskMtimeMs?: number) => {
    setConflictState(null)
    if (typeof diskMtimeMs !== 'number') {
      showToast({ type: 'error', message: '无法获取磁盘状态，请重试' })
      return
    }
    await saveDoc(relPath, diskMtimeMs)
  }, [saveDoc])

  const saveAll = useCallback(async () => {
    const keys = Object.keys(openFilesRef.current).filter((p) => {
      const d = openFilesRef.current[p]
      return fullContent(d) !== savedFullContent(d)
    })
    for (const p of keys) await saveDoc(p)
  }, [saveDoc])

  /**
   * 读写分工反向通道：切到知识库阅读同一文件（渲染态/反链/刷题）。
   * 知识库读的是磁盘内容，因此存在未保存修改时先确认是否保存——否则会看到旧内容。
   */
  const dispatchOpenInKnowledge = useCallback((relPath: string) => {
    window.dispatchEvent(new CustomEvent('kb-open-in-knowledge', { detail: { relPath } }))
  }, [])

  const openInKnowledge = useCallback((relPath: string) => {
    const d = openFilesRef.current[relPath]
    if (d && fullContent(d) !== savedFullContent(d)) { setKbReadTarget(relPath); return }
    dispatchOpenInKnowledge(relPath)
  }, [dispatchOpenInKnowledge])

  // Ctrl+S / Ctrl+Shift+S（模块级快捷键：仅激活模块生效）
  useEffect(() => {
    if (!isActive) return
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || (e.key !== 's' && e.key !== 'S')) return
      e.preventDefault()
      if (e.shiftKey) void saveAll()
      else if (activePathRef.current) void saveDoc(activePathRef.current)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isActive, saveAll, saveDoc])

  const closeTab = useCallback((relPath: string) => {
    setOpenFiles((prev) => {
      const next = { ...prev }
      delete next[relPath]
      return next
    })
    setActivePath((p) => {
      if (p !== relPath) return p
      const keys = Object.keys(openFilesRef.current).filter((k) => k !== relPath)
      return keys.length ? keys[keys.length - 1] : null
    })
  }, [])

  /** 关闭标签：有未保存修改时走确认弹窗 */
  const requestCloseTab = useCallback((relPath: string) => {
    const doc = openFilesRef.current[relPath]
    if (doc && fullContent(doc) !== savedFullContent(doc)) {
      setCloseTarget(relPath)
      return
    }
    closeTab(relPath)
  }, [closeTab])

  /** VS Code 式内联创建：在目标目录的树内条目末尾显示命名行（不再居中弹输入框） */
  const askCreateNode = useCallback((dirRel: string, type: 'file' | 'dir') => {
    setCreating({ dirRel, type })
    setExpanded((prev) => new Set(prev).add(dirRel))
  }, [])

  /** 新建知识页：同样走内联行（frontmatter id 模板由 commitCreate 生成） */
  const askCreateKnowledgePage = useCallback((dirRel: string) => {
    setCreating({ dirRel, type: 'knowledge' })
    setExpanded((prev) => new Set(prev).add(dirRel))
  }, [])

  /** 内联提交：按类型清洗并执行创建（文件/目录直接建；知识页带 frontmatter 模板） */
  const commitCreate = useCallback(async (dirRel: string, type: 'file' | 'dir' | 'knowledge', rawName: string) => {
    setCreating(null)
    const root = rootIdRef.current
    if (!root) return
    const name = rawName.trim()
    if (!name) return
    if (type === 'knowledge') {
      await doCreateKnowledgePage(dirRel, name)
      return
    }
    // 文件名净化（Windows 非法字符 → _），中文保留
    const cleaned = name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim() || (type === 'dir' ? '新目录' : '新建文件.md')
    // 双态模型：新建 .md = 草稿（id + status: draft）——知识库不可见，编辑器树可见，可右键归档
    if (type === 'file' && cleaned.toLowerCase().endsWith('.md')) {
      await doCreateKnowledgePage(dirRel, cleaned.slice(0, -3))
      return
    }
    const rel = joinRel(dirRel, cleaned)
    const res = type === 'file' ? await workspaceCreateFile(root, rel) : await workspaceMkdir(root, rel)
    if (!res.ok) { showToast({ type: 'error', message: res.error || '创建失败' }); return }
    const actualRel = res.relPath ?? rel
    if (res.renamed) showToast({ type: 'info', message: `「${baseName(rel)}」已存在，已创建为「${baseName(actualRel)}」` })
    setExpanded((prev) => new Set(prev).add(dirRel))
    await refreshDir(dirRel)
    if (type === 'file') {
      await openFile({ name: baseName(actualRel), type: 'file', size: 0, mtime: Date.now(), relPath: actualRel })
    }
  }, [refreshDir, openFile])

  /**
   * 新建 .md（草稿态，双态模型 2026-09-03）：带 id + status: draft。
   * 草稿 → 编辑器树可见、知识库正式列表/图谱正式节点不可见（publishedOnly 过滤）；
   * 编辑器右键「归档」去掉 status: draft 后进知识库/图谱（含虚化引用锚——草稿保留 id）。
   */
  const doCreateKnowledgePage = useCallback(async (dirRel: string, rawTitle: string) => {
    const title = rawTitle.trim()
    if (!title) return
    const root = rootIdRef.current
    if (!root) return
    // 文件名净化（Windows 非法字符 → _），中文保留
    const stem = title.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim() || 'untitled'
    const rel = joinRel(dirRel, `${stem}.md`)
    const now = new Date().toISOString()
    const content = `---\nid: ${crypto.randomUUID()}\ntitle: ${title}\ntags: []\nstarred: false\nstatus: draft\ncreated: ${now}\nupdated: ${now}\n---\n\n`
    const res = await workspaceCreateFile(root, rel, content)
    const actualRel = res.relPath ?? rel
    if (!res.ok) { showToast({ type: 'error', message: res.error || '创建失败' }); return }
    if (res.renamed) showToast({ type: 'info', message: `已存在同名，已创建为「${baseName(actualRel)}」` })
    setExpanded((prev) => new Set(prev).add(dirRel))
    await refreshDir(dirRel)
    await openFile({ name: baseName(actualRel), type: 'file', size: 0, mtime: Date.now(), relPath: actualRel })
  }, [refreshDir, openFile])

  /** 弹输入框：重命名 */
  const askRename = useCallback((node: TreeNode) => {
    setInputBox({
      title: '重命名',
      placeholder: '新名称',
      initial: baseName(node.relPath),
      submitLabel: '确定',
      onSubmit: (newName) => {
        setInputBox(null)
        void doRename(node, newName)
      },
    })
  }, [])

  const doRename = useCallback(async (node: TreeNode, rawName: string) => {
    const newName = rawName.trim()
    if (!newName || newName === baseName(node.relPath)) return
    const newRel = joinRel(parentRel(node.relPath), newName)
    const root = rootIdRef.current
    if (!root) return
    const res = await workspaceRename(root, node.relPath, newRel)
    if (!res.ok) { showToast({ type: 'error', message: res.error || '重命名失败' }); return }
    setOpenFiles((prev) => {
      const next = { ...prev }
      const d = next[node.relPath]
      if (d) {
        delete next[node.relPath]
        next[newRel] = { ...d, relPath: newRel, language: languageFor(newName) }
      }
      return next
    })
    setActivePath((p) => (p === node.relPath ? newRel : p))
    await refreshDir(parentRel(node.relPath))
    showToast({ type: 'info', message: '已重命名' })
  }, [refreshDir])

  /** 双态模型：归档（published）path 集合刷新 —— 知识库正式页在编辑器树中隐藏 */
  const refreshArchived = useCallback(async () => {
    try {
      const pages = await getKnowledgePages()
      setArchivedPaths(new Set(pages.filter((p) => p.path).map((p) => p.path as string)))
    } catch { /* 无仓库/失败：保持现状 */ }
  }, [])

  useEffect(() => {
    if (!isActive) return
    void refreshArchived()
  }, [isActive, refreshArchived])

  /** 归档(draft=false)/转草稿(draft=true)：主进程改 frontmatter status + 索引失效；本地重载 */
  const togglePageStatus = useCallback(async (relPath: string, draft: boolean) => {
    const root = rootIdRef.current
    if (!root) return
    const doc = openFilesRef.current[relPath]
    if (doc && fullContent(doc) !== savedFullContent(doc)) {
      showToast({ type: 'warning', message: '该文件有未保存修改，请先 Ctrl+S 保存' })
      return
    }
    const res = await workspaceSetMdStatus(root, relPath, draft)
    if (!res.ok) { showToast({ type: 'error', message: res.error || '操作失败' }); return }
    showToast({ type: 'info', message: draft ? '已转为草稿：知识库暂不可见，编辑后可再次归档' : '已归档为知识页：可在知识库中阅读' })
    if (openFilesRef.current[relPath]) closeTab(relPath)
    await refreshDir(parentRel(relPath))
    await refreshArchived()
  }, [refreshDir, refreshArchived, closeTab])

  /** 拖拽移动：把 srcRel 移动到 targetDirRel 下（复用 ws:rename 跨目录移动） */
  const moveNode = useCallback(async (srcRel: string, targetDirRel: string) => {
    const root = rootIdRef.current
    if (!root) return
    const newRel = joinRel(targetDirRel, baseName(srcRel))
    if (newRel === srcRel) return
    const res = await workspaceRename(root, srcRel, newRel)
    if (!res.ok) { showToast({ type: 'error', message: res.error || '移动失败' }); return }
    // 移动的是打开中的文件 → 更新文档 key（目录不会被打开，无需处理其下子文件）
    setOpenFiles((prev) => {
      const next = { ...prev }
      if (next[srcRel]) {
        const d = next[srcRel]
        delete next[srcRel]
        next[newRel] = { ...d, relPath: newRel }
      }
      return next
    })
    setActivePath((p) => (p === srcRel ? newRel : p))
    await refreshDir(parentRel(srcRel))
    if (targetDirRel !== parentRel(srcRel)) await refreshDir(targetDirRel)
  }, [refreshDir])

  const doTrash = useCallback(async (node: TreeNode) => {
    const root = rootIdRef.current
    if (!root) return
    const res = await workspaceTrash(root, node.relPath)
    if (!res.ok) { showToast({ type: 'error', message: res.error || '删除失败' }); return }
    setOpenFiles((prev) => {
      const next = { ...prev }
      delete next[node.relPath]
      return next
    })
    setActivePath((p) => (p === node.relPath ? null : p))
    await refreshDir(parentRel(node.relPath))
    showToast({ type: 'info', message: `已移入回收站：${baseName(node.relPath)}` })
  }, [refreshDir])

  // 右键菜单：Esc / 外部点击关闭
  useEffect(() => {
    if (!ctxMenu) return
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setCtxMenu(null) }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [ctxMenu])

  const activeDoc = activePath ? openFiles[activePath] ?? null : null
  /** 预览内容延迟值：React 19 并发渲染，预览重解析不阻塞输入（大文档打字不卡） */
  const previewContent = useDeferredValue(activeDoc?.content ?? '')
  // 标签栏只驻留「未保存修改」的文件；干净文件仅作当前预览，不占标签（切走即回收）
  const openList = Object.keys(openFiles).filter((rel) => isDirtyDoc(openFiles[rel]))

  // ===== 空状态：未打开仓库 =====
  if (!rootId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-5 p-8">
        <button
          onClick={() => void handleOpenDir()}
          className="flex items-center gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] px-5 py-3 text-[14px] text-[var(--text-primary)] shadow-sm transition-colors hover:bg-[var(--bg-hover)]"
        >
          <FolderOpen size={18} className="text-[var(--accent)]" />
          打开文件夹作为仓库
        </button>
        {recent.length > 0 && (
          <div className="w-full max-w-sm">
            <div className="mb-2 text-[12px] font-medium text-[var(--text-muted)]">最近打开</div>
            <div className="flex flex-col gap-1">
              {recent.map((r) => (
                <button
                  key={r.rootId}
                  onClick={() => void handleOpenRecent(r)}
                  className="flex items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                >
                  <Folder size={14} className="shrink-0 text-[var(--accent)]" />
                  <span className="min-w-0 flex-1 truncate">{r.name}</span>
                  <span className="truncate text-[11px] text-[var(--text-tertiary)]">{r.path}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* 顶部工具栏 */}
      <div className="flex items-center gap-2 border-b border-[var(--border-color)] px-3 py-1.5">
        <button
          onClick={() => void handleOpenDir()}
          title="切换仓库"
          className="flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)]"
        >
          <FolderOpen size={14} className="shrink-0 text-[var(--accent)]" />
          <span className="truncate">{rootName}</span>
          <ChevronRight size={12} className="shrink-0 text-[var(--text-muted)]" />
        </button>
        <div className="mx-1 h-4 w-px bg-[var(--border-color)]" />
        <button
          onClick={() => askCreateNode('', 'file')}
          title="新建文件"
          className="flex items-center gap-1 rounded-md px-2 py-1 text-[12.5px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        >
          <Plus size={14} />
          新建文件
        </button>
        <button
          onClick={() => askCreateNode('', 'dir')}
          title="新建文件夹"
          className="flex items-center gap-1 rounded-md px-2 py-1 text-[12.5px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        >
          <FolderPlus size={14} />
          新建文件夹
        </button>
        <button
          onClick={() => askCreateKnowledgePage('')}
          title="新建知识页（带 frontmatter id，进入知识库索引）"
          className="flex items-center gap-1 rounded-md px-2 py-1 text-[12.5px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        >
          <FilePlus2 size={14} />
          新建知识页
        </button>
        <div className="flex-1" />
        {activeDoc?.language === 'markdown' && (
          <>
            <button
              onClick={() => { setOutlineOpen((v) => !v); }}
              title="大纲（跳转标题）"
              className={`flex items-center gap-1 rounded-md px-2 py-1 text-[12.5px] transition-colors ${
                outlineOpen
                  ? 'bg-[var(--bg-hover)] text-[var(--text-primary)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
              }`}
            >
              <ListTree size={14} />
              大纲
            </button>
            <button
              onClick={() => openInKnowledge(activeDoc.relPath)}
              title="在知识库中阅读（渲染效果 / 反链 / 刷题）。有未保存修改时会先确认保存"
              className="flex items-center gap-1 rounded-md px-2 py-1 text-[12.5px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            >
              <BookOpen size={14} />
              在知识库中阅读
            </button>
            <button
              onClick={togglePreview}
              title="分栏预览（左编辑 / 右实时渲染）"
              className={`flex items-center gap-1 rounded-md px-2 py-1 text-[12.5px] transition-colors ${
                previewOpen
                  ? 'bg-[var(--bg-hover)] text-[var(--text-primary)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
              }`}
            >
              {previewOpen ? <PanelRightClose size={14} /> : <Eye size={14} />}
              预览
            </button>
          </>
        )}
        {dirtyCount > 0 && (
          <button
            onClick={() => void saveAll()}
            title="保存全部 (Ctrl+Shift+S)"
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[12.5px] text-[var(--accent)] transition-colors hover:bg-[var(--bg-hover)]"
          >
            <SaveAll size={14} />
            保存全部 ({dirtyCount})
          </button>
        )}
      </div>

      {/* 主体：文件树 + 编辑区。Workbench 外壳模式下文件树 portal 到全局侧栏槽（侧栏槽渲染在编辑器组左侧） */}
      <div className="flex min-h-0 flex-1">
        {/* 资源管理器列（含标题）：内嵌布局原样显示；workbench 模式改由 portal 渲染到全局侧栏槽 */}
        {(() => {
          const treeColumn = (
            <>
              <div className="flex items-center gap-1 border-b border-[var(--border-color)] px-2 py-1 text-[11.5px] text-[var(--text-muted)]">
                <FileText size={12} />
                资源管理器
              </div>
              <FileTree
                dirCache={dirCache}
                expanded={expanded}
                activePath={activePath}
                onToggleDir={(p) => void toggleDir(p)}
                onOpenFile={(n) => void openFile(n)}
                onMove={(src, dst) => void moveNode(src, dst)}
                creating={creating}
                onCommitCreate={(dirRel, type, raw) => void commitCreate(dirRel, type, raw)}
                onCancelCreate={() => setCreating(null)}
                hiddenRelPaths={archivedPaths}
                onContextMenu={(e, n) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setCtxMenu({ x: e.clientX, y: e.clientY, node: n })
                }}
              />
            </>
          )
          if (sidebarEl) {
            // Workbench 外壳：文件树 portal 到全局侧栏槽（App 侧栏槽自带标题区），此处不再内嵌树列
            return createPortal(<div className="flex h-full w-full flex-col overflow-hidden">{treeColumn}</div>, sidebarEl)
          }
          return <div className="flex w-[220px] shrink-0 flex-col border-r border-[var(--border-color)]">{treeColumn}</div>
        })()}

        <div className="flex min-w-0 flex-1 flex-col">
          {/* 标签栏 */}
          {openList.length > 0 && (
            <div className="flex items-center gap-0.5 overflow-x-auto border-b border-[var(--border-color)] px-1.5 pt-1">
              {openList.map((rel) => {
                const d = openFiles[rel]
                const isDirty = fullContent(d) !== savedFullContent(d)
                const isActiveTab = rel === activePath
                return (
                  <div
                    key={rel}
                    onClick={() => setActivePath(rel)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setTabCtx({ x: e.clientX, y: e.clientY, rel })
                    }}
                    className={`group flex max-w-[200px] cursor-pointer items-center gap-1.5 rounded-t-md border border-b-0 px-2.5 py-1.5 text-[12.5px] transition-colors ${
                      isActiveTab
                        ? 'border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-primary)]'
                        : 'border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                    }`}
                    title={rel}
                  >
                    <span className="truncate">{baseName(rel)}</span>
                    {isDirty ? (
                      <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--accent)]" />
                    ) : (
                      <span className="h-2 w-2 shrink-0 rounded-full bg-transparent" />
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); requestCloseTab(rel) }}
                      className="shrink-0 rounded p-0.5 text-[var(--text-tertiary)] opacity-0 transition-opacity group-hover:opacity-100 hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                    >
                      <X size={11} />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
          {/* 编辑器 */}
          <div className="min-h-0 flex-1 relative" onClick={() => setOutlineOpen(false)}>
            {/* 主体：pdf 文档类型 → PdfReaderView（懒加载 canvas）；其余 → R5 分栏（Monaco | 预览） */}
            {activeDoc?.language === 'pdf' && rootId ? (
              <PdfReaderView key={activeDoc.relPath} rootId={rootId} relPath={activeDoc.relPath} name={baseName(activeDoc.relPath)} />
            ) : (
            <div className="flex h-full min-h-0">
              <div className="min-w-0 flex-1">
                <MonacoPane ref={monacoRef} doc={activeDoc} onChange={handleChange} dimEnabled={markdownDim} />
              </div>
              {previewOpen && activeDoc?.language === 'markdown' && (
                <>
                  <div className="w-px shrink-0 bg-[var(--border-color)]" />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex items-center gap-1.5 border-b border-[var(--border-color)] px-3 py-1 text-[11.5px] text-[var(--text-muted)]">
                      <Eye size={12} />
                      预览
                      <span className="ml-auto text-[var(--text-tertiary)]">随编辑实时更新</span>
                    </div>
                    <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
                      <MarkdownPreview
                        content={previewContent}
                        onWikiLink={handleWikiLink}
                        knownWikiTitles={knownWikiTitles}
                      />
                    </div>
                  </div>
                </>
              )}
            </div>
            )}
            {/* 大纲浮层：markdown 标题树 → 点击跳转 */}
            {outlineOpen && activeDoc?.language === 'markdown' && (
              <div
                className="absolute top-2 right-2 z-20 w-72 max-h-[65%] overflow-auto rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)]/98 shadow-xl py-1.5 flex flex-col"
                onClick={(e) => e.stopPropagation()}
              >
                {(() => {
                  const items = extractOutline(activeDoc.content)
                  if (items.length === 0) {
                    return <div className="px-3 py-2 text-[12px] text-[var(--text-muted)]">无标题（用 # 标记章节后即可跳转）</div>
                  }
                  return items.map((it) => (
                    <button
                      key={`${it.line}-${it.text}`}
                      onClick={() => { monacoRef.current?.revealLine(it.line); setOutlineOpen(false) }}
                      title={`跳转到第 ${it.line} 行`}
                      className="flex items-center gap-1.5 px-3 py-1 text-left text-[12.5px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                      style={{ paddingLeft: 12 + (it.level - 1) * 14 }}
                    >
                      <span className="shrink-0 text-[10px] text-[var(--text-tertiary)]">{it.line}</span>
                      <span className="min-w-0 truncate">{it.text}</span>
                    </button>
                  ))
                })()}
              </div>
            )}
          </div>
          {/* 状态栏 */}
          <div className="flex items-center gap-3 border-t border-[var(--border-color)] px-3 py-1 text-[11px] text-[var(--text-muted)]">
            {activeDoc && (
              <>
                <span>{baseName(activeDoc.relPath)}</span>
                <span>{activeDoc.language}</span>
                {activeDoc.editable ? (
                  <span className="text-[var(--text-tertiary)]">UTF-8</span>
                ) : (
                  <span className="text-[var(--text-warning)]">只读</span>
                )}
                {activeDoc.frontmatterPrefix !== undefined && (
                  <button
                    onClick={() => { setFmDraft({ relPath: activeDoc.relPath, text: activeDoc.frontmatterPrefix ?? '' }); setFmText(activeDoc.frontmatterPrefix ?? '') }}
                    title="查看/编辑文件头元数据（frontmatter，保存后写回磁盘）"
                    className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[var(--accent)] transition-colors hover:bg-[var(--bg-hover)]"
                  >
                    <Braces size={11} />
                    属性
                  </button>
                )}
                <span className="ml-auto">{activeDoc.size.toLocaleString()} B</span>
                {fullContent(activeDoc) !== savedFullContent(activeDoc) && <span className="text-[var(--accent)]">未保存</span>}
              </>
            )}
          </div>
        </div>
      </div>

      {/* frontmatter 查看/编辑弹窗 */}
      {fmDraft && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/30" onClick={() => setFmDraft(null)}>
          <div
            className="flex w-[480px] max-w-[90vw] flex-col gap-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-medium text-[var(--text-primary)]">文件属性（frontmatter）</span>
              <button onClick={() => setFmDraft(null)} className="rounded p-1 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">
                <X size={14} />
              </button>
            </div>
            <p className="text-[11px] leading-relaxed text-[var(--text-tertiary)]">
              这是文件头部的元数据（含 <code className="text-[var(--text-primary)]">---</code> 包裹），正文编辑时不显示。清空全部内容可移除元数据。
            </p>
            <textarea
              value={fmText}
              onChange={(e) => setFmText(e.target.value)}
              spellCheck={false}
              autoFocus
              className="h-48 w-full resize-none rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-2.5 font-mono text-[12px] leading-relaxed text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setFmDraft(null)}
                className="rounded-lg border border-[var(--border-color)] px-3 py-1.5 text-[12px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)]"
              >
                取消
              </button>
              <button
                onClick={() => {
                  const rel = fmDraft.relPath
                  const doc = openFilesRef.current[rel]
                  if (doc) {
                    setOpenFiles((prev) => (prev[rel] ? { ...prev, [rel]: { ...prev[rel], frontmatterPrefix: fmText } } : prev))
                    void saveDoc(rel)
                  }
                  setFmDraft(null)
                }}
                className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-[12px] text-white transition-opacity hover:opacity-90"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 右键菜单 */}
      {ctxMenu && (
        <div className="fixed inset-0 z-[70]" onClick={() => setCtxMenu(null)} onContextMenu={(e) => { e.preventDefault(); setCtxMenu(null) }}>
          <div
            className="absolute min-w-[150px] rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] py-1 shadow-xl"
            style={{ left: Math.min(ctxMenu.x, window.innerWidth - 170), top: Math.min(ctxMenu.y, window.innerHeight - 180) }}
            onClick={(e) => e.stopPropagation()}
          >
            {ctxMenu.node.type === 'dir' && (
              <>
                <button onClick={() => { const d = ctxMenu.node.relPath; setCtxMenu(null); askCreateNode(d, 'file') }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-[12.5px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]">
                  <Plus size={13} className="text-[var(--text-muted)]" />新建文件
                </button>
                <button onClick={() => { const d = ctxMenu.node.relPath; setCtxMenu(null); askCreateNode(d, 'dir') }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-[12.5px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]">
                  <FolderPlus size={13} className="text-[var(--text-muted)]" />新建文件夹
                </button>
                <button onClick={() => { const d = ctxMenu.node.relPath; setCtxMenu(null); askCreateKnowledgePage(d) }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-[12.5px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]">
                  <FilePlus2 size={13} className="text-[var(--text-muted)]" />新建知识页
                </button>
                <div className="mx-2 my-0.5 border-t border-[var(--border-color)]" />
              </>
            )}
            {ctxMenu.node.type === 'file' && (
              <button onClick={() => { const n = ctxMenu.node; setCtxMenu(null); void openFile(n) }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-[12.5px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]">
                <FileText size={13} className="text-[var(--text-muted)]" />打开
              </button>
            )}
            {ctxMenu.node.type === 'file' && ctxMenu.node.relPath.toLowerCase().endsWith('.md') && !archivedPaths.has(ctxMenu.node.relPath) && (
              <button onClick={() => { const rel = ctxMenu.node.relPath; setCtxMenu(null); void togglePageStatus(rel, false) }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-[12.5px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]">
                <Archive size={13} className="text-[var(--text-muted)]" />归档为知识页
              </button>
            )}
            {ctxMenu.node.type === 'file' && ctxMenu.node.relPath.toLowerCase().endsWith('.md') && (
              <button onClick={() => { const rel = ctxMenu.node.relPath; setCtxMenu(null); openInKnowledge(rel) }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-[12.5px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]">
                <BookOpen size={13} className="text-[var(--text-muted)]" />在知识库中阅读
              </button>
            )}
            {ctxMenu.node.relPath !== '' && (
              <>
                <button onClick={() => { const n = ctxMenu.node; setCtxMenu(null); askRename(n) }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-[12.5px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]">
                  <Pencil size={13} className="text-[var(--text-muted)]" />重命名
                </button>
                <button onClick={() => { const n = ctxMenu.node; setCtxMenu(null); setTrashTarget(n) }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-[12.5px] text-[var(--text-danger)] hover:bg-[var(--bg-hover)]">
                  <Trash2 size={13} />删除（回收站）
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* tab 右键：状态动作（归档为知识页 / 转为草稿）+ 关闭 */}
      {tabCtx && (
        <div className="fixed inset-0 z-[70]" onClick={() => setTabCtx(null)} onContextMenu={(e) => { e.preventDefault(); setTabCtx(null) }}>
          <div
            className="absolute min-w-[160px] rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] py-1 shadow-xl"
            style={{ left: Math.min(tabCtx.x, window.innerWidth - 180), top: Math.min(tabCtx.y, window.innerHeight - 120) }}
            onClick={(e) => e.stopPropagation()}
          >
            {tabCtx.rel.toLowerCase().endsWith('.md') && (
              <>
                {archivedPaths.has(tabCtx.rel) ? (
                  <button onClick={() => { const rel = tabCtx.rel; setTabCtx(null); void togglePageStatus(rel, true) }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-[12.5px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]">
                    <FilePenLine size={13} className="text-[var(--text-muted)]" />转为草稿（修改中）
                  </button>
                ) : (
                  <button onClick={() => { const rel = tabCtx.rel; setTabCtx(null); void togglePageStatus(rel, false) }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-[12.5px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]">
                    <Archive size={13} className="text-[var(--text-muted)]" />归档为知识页
                  </button>
                )}
                <div className="mx-2 my-0.5 border-t border-[var(--border-color)]" />
              </>
            )}
            <button onClick={() => { const rel = tabCtx.rel; setTabCtx(null); requestCloseTab(rel) }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-[12.5px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]">
              <X size={13} className="text-[var(--text-muted)]" />关闭
            </button>
          </div>
        </div>
      )}

      {/* 删除确认 */}
      <ConfirmDialog
        open={trashTarget !== null}
        title="移入回收站"
        message={`「${trashTarget ? baseName(trashTarget.relPath) : ''}」将被移入系统回收站，可恢复。确定删除？`}
        confirmLabel="删除"
        showCheckbox={false}
        onConfirm={() => { if (trashTarget) void doTrash(trashTarget); setTrashTarget(null) }}
        onCancel={() => setTrashTarget(null)}
      />

      {/* 关闭未保存标签确认 */}
      <ConfirmDialog
        open={closeTarget !== null}
        title="未保存的修改"
        message={`「${closeTarget ? baseName(closeTarget) : ''}」有未保存的修改，确定关闭？`}
        confirmLabel="关闭"
        showCheckbox={false}
        onConfirm={() => { if (closeTarget) closeTab(closeTarget); setCloseTarget(null) }}
        onCancel={() => setCloseTarget(null)}
      />

      {/* 回跳知识库前未保存确认：知识库渲染的是磁盘内容，先保存才能看到最新渲染 */}
      <ConfirmDialog
        open={kbReadTarget !== null}
        title="先保存？"
        message={`「${kbReadTarget ? baseName(kbReadTarget) : ''}」有未保存的修改。知识库阅读的是磁盘内容，先保存才能看到最新渲染效果。`}
        confirmLabel="保存并查看"
        cancelLabel="不保存直接查看"
        showCheckbox={false}
        onConfirm={() => {
          const rel = kbReadTarget
          setKbReadTarget(null)
          if (rel) void saveDoc(rel).then((ok) => {
            if (ok) dispatchOpenInKnowledge(rel)
            else showToast({ type: 'info', message: '保存未完成（磁盘冲突），请先在编辑器中处理' })
          })
        }}
        onCancel={() => {
          const rel = kbReadTarget
          setKbReadTarget(null)
          if (rel) {
            showToast({ type: 'info', message: '未保存，知识库显示的是磁盘上的旧内容' })
            dispatchOpenInKnowledge(rel)
          }
        }}
      />

      {/* 新建 / 重命名输入弹窗（Electron 渲染进程不支持 window.prompt） */}
      {inputBox && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/30" onClick={() => setInputBox(null)}>
          <div
            className="w-80 rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 text-[13px] font-medium text-[var(--text-primary)]">{inputBox.title}</div>
            <input
              autoFocus
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder={inputBox.placeholder}
              className="w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
              onKeyDown={(e) => {
                if (e.key === 'Enter') inputBox.onSubmit(inputValue)
                if (e.key === 'Escape') setInputBox(null)
              }}
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => setInputBox(null)}
                className="rounded-md px-3 py-1 text-[12.5px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)]"
              >
                取消
              </button>
              <button
                onClick={() => inputBox.onSubmit(inputValue)}
                className="rounded-md bg-[var(--accent)] px-3 py-1 text-[12.5px] text-white transition-opacity hover:opacity-90"
              >
                {inputBox.submitLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 保存冲突对话框：磁盘被外部修改（对标 VS Code 的 saveConflictResolution） */}
      {conflictState && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/30" onClick={() => setConflictState(null)}>
          <div
            className="w-[380px] rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-1 text-[13px] font-medium text-[var(--text-warning)]">
              {conflictState.missing ? '文件已在磁盘上被删除' : '文件已被外部修改'}
            </div>
            <div className="mb-3 text-[12.5px] leading-relaxed text-[var(--text-secondary)]">
              「{baseName(conflictState.relPath)}」在编辑期间被其他程序改动
              {conflictState.missing ? '或移走' : ''}。要如何处理？
            </div>
            <div className="flex flex-col gap-1.5">
              <button
                onClick={() => void reloadFromDisk(conflictState.relPath)}
                className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-left text-[12.5px] text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)]"
              >
                <span className="font-medium">重新加载</span>
                <span className="ml-2 text-[var(--text-tertiary)]">放弃本地修改，取磁盘最新内容</span>
              </button>
              <button
                onClick={() => void overwriteDisk(conflictState.relPath, conflictState.diskMtimeMs)}
                className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-left text-[12.5px] text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)]"
              >
                <span className="font-medium">覆盖磁盘</span>
                <span className="ml-2 text-[var(--text-tertiary)]">保留我的修改，写回磁盘</span>
              </button>
              <button
                onClick={() => setConflictState(null)}
                className="rounded-lg px-3 py-2 text-left text-[12.5px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)]"
              >
                暂不处理（继续编辑）
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
