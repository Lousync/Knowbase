/**
 * 文件操作撤销栈（跨模块共用：编辑区 + 知识库）
 *
 * 覆盖范围（2026-09-10 用户拍板）：**移动 / 重命名**、**新建** 两类结构性操作。
 * - 删除（ws:trash）不纳入：走系统回收站，程序内无 restore 通道（见 workspaceManager「移入系统回收站」）。
 * - 内容编辑不纳入：文本撤销由 Monaco 自带。键盘层按焦点让路，两者互不干扰。
 *
 * 两模块共用同一份栈：在知识库拖拽移动后切到编辑区，Ctrl+Z 依然能撤回。
 * 栈项自带 rootId，切换仓库后旧记录自动失效（见 undoFileOp/redoFileOp 的校验）。
 *
 * 撤销/重做成功后派发 `kb-fs-op-changed`（detail = FileOpResult），
 * 模块据此刷新目录 / 迁移已打开文档的 key / 关闭已被移除文档的标签。
 */
import {
  workspaceCreateFile, workspaceMkdir, workspaceRename, workspaceTrash, workspaceGetCurrent,
} from './ipc'
import { showToast } from './toast'
import { isEditingInput } from './shortcuts'

/** 一次撤销/重做的执行结果（同时作为 kb-fs-op-changed 的 detail） */
export interface FileOpResult {
  ok: boolean
  /** 人类可读的动作描述，用于 toast */
  label: string
  /** 受影响的父目录（需刷新的） */
  dirs: string[]
  /** 内容移动了位置：编辑器据此迁移打开中文档的 key */
  remap?: { from: string; to: string }
  /** 内容被移除：编辑器据此关闭对应标签 */
  removed?: string
  error?: string
}

type FileOp =
  | { kind: 'move'; rootId: string; from: string; to: string; name: string }
  | { kind: 'create'; rootId: string; relPath: string; isDir: boolean; content?: string; name: string }

const MAX_DEPTH = 50
const EVENT = 'kb-fs-op-changed'

const undoStack: FileOp[] = []
const redoStack: FileOp[] = []

// ---- 路径小工具（不引 modules/ 的 types，避免 lib → modules 反向依赖）----
const parentOf = (rel: string): string => {
  const i = rel.lastIndexOf('/')
  return i < 0 ? '' : rel.slice(0, i)
}
const baseOf = (rel: string): string => {
  const i = rel.lastIndexOf('/')
  return i < 0 ? rel : rel.slice(i + 1)
}

/** 记录一次成功的文件操作（会清空重做栈） */
export function recordFileOp(op: FileOp): void {
  undoStack.push(op)
  if (undoStack.length > MAX_DEPTH) undoStack.shift()
  redoStack.length = 0
}

export function canUndoFileOp(): boolean { return undoStack.length > 0 }
export function canRedoFileOp(): boolean { return redoStack.length > 0 }

/** 清空栈（切换仓库等场景可主动调用；undo/redo 内部也会在 rootId 失配时自动清） */
export function clearFileOpHistory(): void {
  undoStack.length = 0
  redoStack.length = 0
}

/** 把主进程错误转成撤销/重做语境下的可读提示（renameWorkspacePath 不覆盖，撞名会安全失败） */
function friendlyError(err?: string): string {
  if (err === '目标已存在') return '目标位置已有同名文件，操作已取消'
  if (err === '源文件不存在') return '源文件已不存在，操作已取消'
  return err || '操作失败'
}

/** 执行一个操作的正向（redo）或反向（undo） */
async function applyOp(op: FileOp, direction: 'undo' | 'redo'): Promise<FileOpResult> {
  if (op.kind === 'move') {
    const from = direction === 'undo' ? op.to : op.from
    const to = direction === 'undo' ? op.from : op.to
    const res = await workspaceRename(op.rootId, from, to)
    if (!res.ok) return { ok: false, label: '', dirs: [], error: friendlyError(res.error) }
    const verb = direction === 'undo' ? '移回' : '移到'
    return {
      ok: true,
      label: `已${direction === 'undo' ? '撤销' : '重做'}：把 ${op.name} ${verb} ${parentOf(to) || '仓库根目录'}`,
      dirs: [...new Set([parentOf(from), parentOf(to)])],
      remap: { from, to },
    }
  }
  // create
  if (direction === 'undo') {
    // 新建的逆操作 = 移除（走系统回收站，与「删除」同语义；用户本意就是撤掉这次新建）
    const res = await workspaceTrash(op.rootId, op.relPath)
    if (!res.ok) return { ok: false, label: '', dirs: [], error: friendlyError(res.error) }
    return {
      ok: true,
      label: `已撤销：移除新建的 ${op.name}`,
      dirs: [parentOf(op.relPath)],
      removed: op.relPath,
    }
  }
  const res = op.isDir
    ? await workspaceMkdir(op.rootId, op.relPath)
    : await workspaceCreateFile(op.rootId, op.relPath, op.content)
  if (!res.ok) return { ok: false, label: '', dirs: [], error: friendlyError(res.error) }
  return { ok: true, label: `已重做：重新创建 ${op.name}`, dirs: [parentOf(op.relPath)] }
}

/** 栈顶操作的 rootId 是否仍是当前仓库；不是则清空并提示，返回 false */
async function ensureSameVault(op: FileOp): Promise<boolean> {
  const cur = await workspaceGetCurrent().catch(() => null)
  if (cur?.rootId && cur.rootId !== op.rootId) {
    clearFileOpHistory()
    showToast({ type: 'info', message: '已切换仓库，文件操作记录已失效' })
    return false
  }
  return true
}

async function run(direction: 'undo' | 'redo'): Promise<FileOpResult | null> {
  const from = direction === 'undo' ? undoStack : redoStack
  const to = direction === 'undo' ? redoStack : undoStack
  const op = from[from.length - 1]
  if (!op) {
    showToast({ type: 'info', message: direction === 'undo' ? '没有可撤销的文件操作' : '没有可重做的文件操作' })
    return null
  }
  if (!(await ensureSameVault(op))) return null

  const result = await applyOp(op, direction)
  if (!result.ok) {
    showToast({ type: 'error', message: result.error || '操作失败' })
    return result
  }
  from.pop()
  to.push(op)
  window.dispatchEvent(new CustomEvent(EVENT, { detail: result }))
  showToast({ type: 'info', message: result.label })
  return result
}

export const undoFileOp = (): Promise<FileOpResult | null> => run('undo')
export const redoFileOp = (): Promise<FileOpResult | null> => run('redo')

/**
 * 安装全局快捷键：Ctrl+Z 撤销、Ctrl+Shift+Z / Ctrl+Y 重做。
 * 焦点在文本编辑环境时直接放行（不 preventDefault），交给 Monaco 自己的文本撤销
 * ——复用 `isEditingInput`（与 Ctrl+C/X/V 让路同一套判定）。
 * 须在 App 挂载时调用一次，返回卸载函数。
 */
export function installFileOpUndoShortcuts(): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return
    const k = e.key.toLowerCase()
    const isRedo = (k === 'z' && e.shiftKey) || k === 'y'
    const isUndo = k === 'z' && !e.shiftKey
    if (!isUndo && !isRedo) return
    if (isEditingInput(e)) return // Monaco / 输入框聚焦：让给文本撤销
    if (isUndo && !canUndoFileOp()) return
    if (isRedo && !canRedoFileOp()) return
    e.preventDefault()
    e.stopPropagation()
    void (isUndo ? undoFileOp() : redoFileOp())
  }
  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
}
