import { useState, useEffect } from 'react'
import { X, Upload, FileJson, Database, AlertCircle, AlertTriangle, CheckCircle, Loader2 } from 'lucide-react'
import { showImportDataDialog, readImportFile, executeImport, importDb } from '../../../lib/ipc'

// ===== version compat =====
const CURRENT_VERSION = '1.2'
const COMPAT_MAP: Record<string, string[]> = {
  '2.0': ['1.0', '1.1', '1.2', '1.3'],
  '1.2': ['1.0', '1.1'],
  '1.1': ['1.0'],
}

function canImport(current: string, dataVersion: string): boolean {
  const [curMajor] = current.split('.')
  const [expMajor] = dataVersion.split('.')
  if (curMajor === expMajor && compareVersions(dataVersion, current) <= 0) return true
  return COMPAT_MAP[current]?.includes(dataVersion) ?? false
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1
    if ((pa[i] || 0) < (pb[i] || 0)) return -1
  }
  return 0
}

function fileExtension(fp: string): string {
  const m = fp.match(/\.([^./\\]+)$/)
  return (m?.[1] || '').toLowerCase()
}

// ===== component =====
type Phase = 'idle' | 'checking' | 'preview_json' | 'preview_db' | 'importing' | 'done' | 'error'
type FileType = 'json' | 'db'

interface Props { onClose: () => void }

export function ImportModal({ onClose }: Props) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState('')
  const [resultMsg, setResultMsg] = useState('')
  const [filePath, setFilePath] = useState('')
  const [fileType, setFileType] = useState<FileType>('json')
  // JSON flow
  const [importedData, setImportedData] = useState<any>(null)
  const [summary, setSummary] = useState<{ blog: number; schedule: number; knowledge: number; version: string; total: number } | null>(null)

  const reset = () => { setError(''); setResultMsg(''); setFilePath(''); setImportedData(null); setSummary(null) }

  // Escape key closes modal
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const handlePickFile = async () => {
    const files = await showImportDataDialog()
    if (!files || files.length === 0) return
    reset()
    setPhase('checking')

    const fp = files[0]
    const ext = fileExtension(fp)
    setFilePath(fp)

    // --- db file → full replacement ---
    if (ext === 'db') {
      setFileType('db')
      setPhase('preview_db')
      return
    }

    // --- json file → merge import ---
    setFileType('json')
    const content = await readImportFile(fp)
    if (!content) { setError('无法读取文件'); setPhase('error'); return }

    let data: any
    try { data = JSON.parse(content) } catch { setError('文件格式错误：无法解析 JSON'); setPhase('error'); return }

    const v = data.exportVersion || 'unknown'
    if (v === 'unknown' || !canImport(CURRENT_VERSION, v)) {
      setError(`数据版本不兼容。数据来自 v${v}，当前 App v${CURRENT_VERSION} 无法导入。`)
      setPhase('error')
      return
    }

    const blogN = (data.blog?.entries?.length || 0) + (data.blog?.tags?.length || 0)
    const schedN = (data.schedule?.todos?.length || 0) + (data.schedule?.tags?.length || 0)
    const knowN = (data.knowledge?.categories?.length || 0) + (data.knowledge?.pages?.length || 0) + (data.knowledge?.tags?.length || 0)

    setImportedData(data)
    setSummary({ blog: blogN, schedule: schedN, knowledge: knowN, version: v, total: blogN + schedN + knowN })
    setPhase('preview_json')
  }

  const handleConfirmJson = async () => {
    if (!importedData) return
    setPhase('importing')
    setResultMsg('正在导入...')
    const r = await executeImport(importedData)
    if (r.success) {
      setResultMsg(r.message)
      setPhase('done')
      window.dispatchEvent(new CustomEvent('data-imported'))
    } else {
      setError(r.message)
      setPhase('error')
    }
  }

  const handleConfirmDb = async () => {
    setPhase('importing')
    setResultMsg('正在替换数据库...')
    const r = await importDb(filePath)
    if (r.success) {
      setResultMsg(r.message)
      setPhase('done')
      window.dispatchEvent(new CustomEvent('data-imported'))
    } else {
      setError(r.message)
      setPhase('error')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl shadow-2xl w-[440px] max-h-[560px] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border-color)] shrink-0">
          <div className="flex items-center gap-2 text-[14px] font-semibold text-[var(--text-primary)]">
            <Upload size={16} className="text-[var(--accent)]" />
            数据导入
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 text-[13px]">
          {/* Idle */}
          {phase === 'idle' && (
            <div className="flex flex-col items-center py-8 gap-4">
              <div className="flex gap-4">
                <div className="flex flex-col items-center gap-1 text-[var(--text-muted)]">
                  <FileJson size={40} />
                  <span className="text-[10px]">JSON</span>
                </div>
                <div className="flex flex-col items-center gap-1 text-[var(--text-muted)]">
                  <Database size={40} />
                  <span className="text-[10px]">DB</span>
                </div>
              </div>
              <div className="text-center space-y-1.5">
                <p className="text-[var(--text-primary)] font-medium">导入数据包</p>
                <p className="text-[12px] text-[var(--text-muted)] leading-relaxed">
                  支持 JSON 数据包（合并到当前数据）<br />
                  或 .db 数据库文件（整体替换）
                </p>
              </div>
              <button onClick={handlePickFile} className="mt-2 flex items-center gap-2 px-5 py-2 text-[13px] bg-[var(--accent)] text-white rounded-lg hover:bg-[var(--accent-hover)] transition-colors">
                <Upload size={16} />选择文件
              </button>
            </div>
          )}

          {/* Checking */}
          {phase === 'checking' && (
            <div className="flex items-center justify-center gap-3 py-12">
              <Loader2 size={20} className="animate-spin text-[var(--accent)]" />
              <span>正在识别文件...</span>
            </div>
          )}

          {/* Preview — JSON */}
          {phase === 'preview_json' && summary && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-[var(--success)]">
                <CheckCircle size={18} />
                <span className="font-medium">JSON 数据包 · 版本兼容 (v{summary.version})</span>
              </div>
              <div className="bg-[var(--bg-tertiary)] rounded-lg p-4 space-y-2 text-[12px]">
                {summary.blog > 0 && <div>📝 博客：<span className="text-[var(--text-primary)] font-medium">{summary.blog}</span> 条</div>}
                {summary.schedule > 0 && <div>📅 日程：<span className="text-[var(--text-primary)] font-medium">{summary.schedule}</span> 条</div>}
                {summary.knowledge > 0 && <div>📚 知识库：<span className="text-[var(--text-primary)] font-medium">{summary.knowledge}</span> 条</div>}
                <div className="text-[10px] text-[var(--text-muted)] pt-1">共 {summary.total} 条 · 合并到当前数据 · 相同 ID 自动跳过</div>
              </div>
              <div className="flex gap-2">
                <button onClick={handleConfirmJson} className="flex-1 py-2 text-[13px] bg-[var(--accent)] text-white rounded-lg hover:bg-[var(--accent-hover)] transition-colors">确认导入</button>
                <button onClick={() => { setPhase('idle'); reset() }} className="px-4 py-2 text-[13px] border border-[var(--border-color)] rounded-lg hover:bg-[var(--bg-hover)] transition-colors">取消</button>
              </div>
            </div>
          )}

          {/* Preview — DB */}
          {phase === 'preview_db' && (
            <div className="space-y-4">
              <div className="flex items-start gap-2 text-[var(--warning)]">
                <AlertTriangle size={18} className="shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">数据库文件</p>
                  <p className="text-[var(--text-secondary)] text-[12px] mt-1">该操作将用导入的数据库文件<strong className="text-[var(--text-primary)]">整体替换</strong>当前全部数据。</p>
                </div>
              </div>
              <div className="bg-[var(--bg-tertiary)] rounded-lg p-4 text-[12px]">
                <p className="text-[var(--text-secondary)]">导入前系统会自动保存当前数据并备份。替换后无需重启，所有模块将立即刷新。</p>
              </div>
              <div className="flex gap-2">
                <button onClick={handleConfirmDb} className="flex-1 py-2 text-[13px] bg-[var(--warning)] text-black font-medium rounded-lg hover:brightness-110 transition-colors">确认替换</button>
                <button onClick={() => { setPhase('idle'); reset() }} className="px-4 py-2 text-[13px] border border-[var(--border-color)] rounded-lg hover:bg-[var(--bg-hover)] transition-colors">取消</button>
              </div>
            </div>
          )}

          {/* Importing */}
          {phase === 'importing' && (
            <div className="flex items-center justify-center gap-3 py-12">
              <Loader2 size={20} className="animate-spin text-[var(--accent)]" />
              <span>{resultMsg}</span>
            </div>
          )}

          {/* Done */}
          {phase === 'done' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-[var(--success)]">
                <CheckCircle size={20} />
                <span className="font-medium">导入完成</span>
              </div>
              <p className="text-[var(--text-secondary)]">{resultMsg}</p>
              <div className="flex gap-2">
                <button onClick={() => { setPhase('idle'); reset() }} className="flex-1 py-2 text-[13px] bg-[var(--accent)] text-white rounded-lg hover:bg-[var(--accent-hover)] transition-colors">导入另一个文件</button>
                <button onClick={onClose} className="px-4 py-2 text-[13px] border border-[var(--border-color)] rounded-lg hover:bg-[var(--bg-hover)] transition-colors">关闭</button>
              </div>
            </div>
          )}

          {/* Error */}
          {phase === 'error' && (
            <div className="space-y-4">
              <div className="flex items-start gap-2 text-[var(--danger)]">
                <AlertCircle size={18} className="shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">导入失败</p>
                  <p className="text-[var(--text-secondary)] text-[12px] mt-1">{error}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => { setPhase('idle'); reset() }} className="flex-1 py-2 text-[13px] bg-[var(--accent)] text-white rounded-lg hover:bg-[var(--accent-hover)] transition-colors">重试</button>
                <button onClick={onClose} className="px-4 py-2 text-[13px] border border-[var(--border-color)] rounded-lg hover:bg-[var(--bg-hover)] transition-colors">关闭</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
