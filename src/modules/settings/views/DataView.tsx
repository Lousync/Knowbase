import { useEffect, useState } from 'react'
import {
  Download, ExternalLink, Loader2, RotateCcw, Database,
} from 'lucide-react'
import { useSettings } from '../../../lib/SettingsContext'
import {
  vaultLegacySummary, vaultImportLegacy, onVaultImportProgress,
  showExportSaveDialog, vaultBackupGetState, vaultBackupExportToZip,
  vaultBackupPickArchive, vaultBackupRestoreArchive, vaultBackupRestoreDb,
} from '../../../lib/ipc'
import { showToast } from '../../../lib/toast'
import { NumberField } from '../components/fields/NumberField'
import { ExportSettingsView } from './ExportSettingsView'

/** 设置 → 数据与仓库：存储读源 / 旧数据导入 / 整仓备份恢复 + 导出 */
export function DataView() {
  const { s, update } = useSettings()
  const [legacy, setLegacy] = useState<{ hasLegacy: boolean; pages: number; blogEntries: number; attachments: number; attachmentBytes: number } | null>(null)
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState('')
  const [backupBusy, setBackupBusy] = useState(false)
  const [backupState, setBackupState] = useState<{ hasBackupDb: boolean; dbBytes: number }>({ hasBackupDb: false, dbBytes: 0 })

  useEffect(() => { void vaultBackupGetState().then((r) => { if (r.ok) setBackupState({ hasBackupDb: !!r.hasBackupDb, dbBytes: r.dbBytes ?? 0 }) }).catch(() => {}) }, [])
  const refreshBackupState = () => void vaultBackupGetState().then((r) => { if (r.ok) setBackupState({ hasBackupDb: !!r.hasBackupDb, dbBytes: r.dbBytes ?? 0 }) }).catch(() => {})

  const doExportFull = async () => {
    try {
      const d = new Date()
      const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const res = await showExportSaveDialog({ defaultName: `knowbase-export-${stamp}.zip`, filters: [{ name: 'ZIP 压缩包', extensions: ['zip'] }] })
      const filePath = res?.filePath
      if (!filePath) return
      setBackupBusy(true)
      const r = await vaultBackupExportToZip(filePath)
      setBackupBusy(false)
      showToast({ type: 'info', message: `整仓备份完成：${r.fileCount} 个文件（含 sqlite 快照 ${(r.dbBytes / 1024).toFixed(0)} KB）` })
      refreshBackupState()
    } catch (e) {
      setBackupBusy(false)
      showToast({ type: 'error', message: `导出失败：${(e as Error).message}` })
    }
  }
  const doRestoreArchive = async () => {
    try {
      const archive = await vaultBackupPickArchive()
      if (!archive) return
      setBackupBusy(true)
      const r = await vaultBackupRestoreArchive(archive)
      setBackupBusy(false)
      if (!r.ok) { showToast({ type: 'error', message: r.message || '恢复失败' }); return }
      showToast({ type: 'info', message: `已解压 ${r.written} 个文件到 ${r.target}${r.dbFound ? '（含 sqlite 快照，可继续还原数据库）' : ''}` })
      refreshBackupState()
    } catch (e) {
      setBackupBusy(false)
      showToast({ type: 'error', message: `恢复失败：${(e as Error).message}` })
    }
  }
  const doRestoreDb = async () => {
    try {
      const r = await vaultBackupRestoreDb()
      showToast({ type: 'info', message: r.ok ? 'sqlite 快照已还原到数据目录，重启应用后生效（小模块回到数据库读源可见）' : '还原失败' })
    } catch (e) {
      showToast({ type: 'error', message: `还原失败：${(e as Error).message}` })
    }
  }

  useEffect(() => { vaultLegacySummary().then(setLegacy).catch(() => {}) }, [])
  useEffect(() => {
    const un = onVaultImportProgress((p) => {
      if (p.phase === 'done') {
        setImporting(false)
        setImportMsg('')
        showToast({ type: 'info', message: p.message || '导入完成' })
      } else if (p.phase === 'error') {
        setImporting(false)
        setImportMsg('')
        showToast({ type: 'error', message: p.message || '导入失败' })
      } else {
        setImportMsg(p.message || '正在导入…')
      }
    })
    return un
  }, [])

  const startImport = async () => {
    setImporting(true)
    setImportMsg('准备导入…')
    try {
      const r = await vaultImportLegacy({})
      if (!r.started && r.error) {
        setImporting(false)
        showToast({ type: 'error', message: r.error })
      }
    } catch {
      setImporting(false)
      showToast({ type: 'error', message: '启动导入失败' })
    }
  }

  return (
    <div>
      <h2 className="text-[15px] font-medium text-[var(--text-primary)] mb-1">数据与仓库</h2>
      <p className="text-[12px] text-[var(--text-muted)] mb-6">存储形态、迁移、备份与导出</p>

      {/* 存储与迁移（去库化） */}
      <div className="mb-8" data-setting-anchor="advanced.storage">
        <h3 className="text-[12px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-3">存储与迁移</h3>
        <div className="max-w-md space-y-4">
          <div>
            <label className="block text-[12px] text-[var(--text-secondary)] mb-1">知识库读源</label>
            <select
              value={s.storageKnowledge}
              onChange={(e) => update('storageKnowledge', e.target.value)}
              className="w-full px-2.5 py-1.5 text-[12px] bg-[var(--input-bg)] border border-[var(--border-color)] rounded outline-none focus:border-[var(--accent)] text-[var(--text-primary)]"
            >
              <option value="vault">仓库文件（默认 · 页面为 .md + 索引 .json，编辑在编辑器模块）</option>
              <option value="sqlite">数据库（过渡期 · 知识库内直接编辑，迁完后删除）</option>
            </select>
            <p className="text-[11px] text-[var(--text-muted)] mt-1 leading-relaxed">
              数据以仓库文件存放，页面编辑在编辑器模块进行。
            </p>
          </div>
          <div>
            <label className="block text-[12px] text-[var(--text-secondary)] mb-1">博客读源</label>
            <select
              value={s.storageBlog}
              onChange={(e) => update('storageBlog', e.target.value)}
              className="w-full px-2.5 py-1.5 text-[12px] bg-[var(--input-bg)] border border-[var(--border-color)] rounded outline-none focus:border-[var(--accent)] text-[var(--text-primary)]"
            >
              <option value="sqlite">数据库（当前形态 · 日记存 sqlite，默认）</option>
              <option value="vault">仓库文件（灰度 · blog/年份/*.md + frontmatter）</option>
            </select>
            <p className="text-[11px] text-[var(--text-muted)] mt-1 leading-relaxed">
              vault 读源：博文改读当前仓库 blog/*.md（每天一篇，标签/收藏/置顶存 frontmatter），编辑保存直接写文件；验证稳定后切默认
            </p>
          </div>
          <div>
            <label className="block text-[12px] text-[var(--text-secondary)] mb-1">结构化模块数据（书签等）</label>
            <select
              value={s.storageData}
              onChange={(e) => update('storageData', e.target.value)}
              className="w-full px-2.5 py-1.5 text-[12px] bg-[var(--input-bg)] border border-[var(--border-color)] rounded outline-none focus:border-[var(--accent)] text-[var(--text-primary)]"
            >
              <option value="sqlite">数据库（当前形态 · 默认）</option>
              <option value="vault">仓库文件（灰度 · .knowbase/modules/*.json）</option>
            </select>
            <p className="text-[11px] text-[var(--text-muted)] mt-1 leading-relaxed">
              已接入：书签（书签/收藏）.knowbase/modules/bookmarks/*.json；其余打卡/体重/习惯等模块将陆续接入同一开关
            </p>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => void startImport()}
                disabled={importing}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-[var(--text-primary)] border border-[var(--border-color)] rounded hover:bg-[var(--bg-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {importing ? <Loader2 size={12} className="animate-spin" /> : <Database size={12} />}
                导入旧数据到当前仓库
              </button>
              {legacy?.hasLegacy && !importing && (
                <span className="text-[11px] text-[var(--text-muted)]">
                  检测到旧数据：知识 {legacy.pages} 篇 · 博客 {legacy.blogEntries} 篇 · 附件 {legacy.attachments} 个
                </span>
              )}
            </div>
            {importing && (
              <div className="mt-2 flex items-center gap-1.5 text-[12px] text-[var(--text-secondary)]">
                <Loader2 size={12} className="animate-spin text-[var(--accent)]" />
                {importMsg}（原库自动备份，可回滚）
              </div>
            )}
            {legacy && !legacy.hasLegacy && !importing && (
              <p className="text-[11px] text-[var(--text-muted)] mt-1">未检测到旧版数据库数据</p>
            )}
          </div>
          <div>
            <label className="block text-[12px] text-[var(--text-secondary)] mb-1">整仓备份 / 恢复</label>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => void doExportFull()}
                disabled={backupBusy}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-[var(--text-primary)] border border-[var(--border-color)] rounded hover:bg-[var(--bg-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {backupBusy ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                导出整仓备份（zip）
              </button>
              <button
                onClick={() => void doRestoreArchive()}
                disabled={backupBusy}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-[var(--text-primary)] border border-[var(--border-color)] rounded hover:bg-[var(--bg-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ExternalLink size={12} />
                从备份恢复仓库（解压）
              </button>
              <button
                onClick={() => void doRestoreDb()}
                disabled={!backupState.hasBackupDb}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-[var(--text-primary)] border border-[var(--border-color)] rounded hover:bg-[var(--bg-hover)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title="把仓库 .knowbase/backup/knowledge.db 还原回数据目录（重启生效）"
              >
                <RotateCcw size={12} />
                还原 sqlite 快照（重启生效）
              </button>
            </div>
            <p className="text-[11px] text-[var(--text-muted)] mt-1 leading-relaxed">
              备份含 sqlite 快照，恢复仓库后可还原。
              {backupState.hasBackupDb ? `当前快照 ${(backupState.dbBytes / 1024).toFixed(0)} KB` : '当前暂无快照'}
            </p>
          </div>
        </div>
      </div>

      {/* 回收站 */}
      <div className="mb-8" data-setting-anchor="data.recycleDays">
        <h3 className="text-[12px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-3">回收站</h3>
        <div className="max-w-md space-y-3">
          <div>
            <label className="block text-[12px] text-[var(--text-secondary)] mb-1">保留天数</label>
            <NumberField
              value={s.recycleBinRetentionDays}
              onCommit={(v) => update('recycleBinRetentionDays', v)}
              min={1}
              max={3650}
              step={1}
              unit="天"
              presets={[7, 30, 90, 365]}
              defaultValue={30}
            />
            <p className="text-[11px] text-[var(--text-muted)] mt-1.5 leading-relaxed">
              超过保留天数的内容将自动清除。
            </p>
          </div>
        </div>
      </div>

      {/* 导出（默认编码） */}
      <ExportSettingsView />
    </div>
  )
}
