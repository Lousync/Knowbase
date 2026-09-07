import { useState } from 'react'
import {
  Download, ExternalLink, Loader2,
} from 'lucide-react'
import { useSettings } from '../../../lib/SettingsContext'
import {
  showExportSaveDialog, vaultBackupExportToZip,
  vaultBackupPickArchive, vaultBackupRestoreArchive,
} from '../../../lib/ipc'
import { showToast } from '../../../lib/toast'
import { NumberField } from '../components/fields/NumberField'
import { ExportSettingsView } from './ExportSettingsView'

/**
 * 设置 → 数据与仓库：存储读源 + 整仓备份恢复 + 导出。
 * R6 去库化收尾：旧库一次性迁移器（vaultLegacySummary/vaultImportLegacy）与
 * sqlite 快照还原（vaultBackupGetState/vaultBackupRestoreDb）已删除，
 * 备份 = 当前仓库 .knowbase/ 目录整包 zip。
 */
export function DataView() {
  const { s, update } = useSettings()
  const [backupBusy, setBackupBusy] = useState(false)

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
      showToast({ type: 'info', message: `整仓备份完成：${r.fileCount} 个文件` })
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
      showToast({ type: 'info', message: `已解压 ${r.written} 个文件到 ${r.target}` })
    } catch (e) {
      setBackupBusy(false)
      showToast({ type: 'error', message: `恢复失败：${(e as Error).message}` })
    }
  }

  return (
    <div>
      <h2 className="text-[15px] font-medium text-[var(--text-primary)] mb-1">数据与仓库</h2>
      <p className="text-[12px] text-[var(--text-muted)] mb-6">存储形态、迁移、备份与导出</p>

      {/* 博客读源（storageKnowledge / storageData 两键已随 sqlite 读源退役） */}
      <div className="mb-8" data-setting-anchor="advanced.storage">
        <h3 className="text-[12px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-3">读源与备份</h3>
        <div className="max-w-md space-y-4">
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
            </div>
            <p className="text-[11px] text-[var(--text-muted)] mt-1 leading-relaxed">
              备份 = 当前仓库 .knowbase/ 目录整包 zip（md/JSON/附件全量），恢复时解压到目标目录后作为仓库打开。
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
