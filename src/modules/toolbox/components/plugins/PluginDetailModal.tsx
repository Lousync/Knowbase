import { useState } from 'react'
import { X, Trash2, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react'
import { showToast } from '../../../../lib/toast'
import { pluginSetEnabled, pluginUninstall, pluginGetContribution, createHabit, createBookmarkCategory, createBookmarkItem, bookmarkGetAll } from '../../../../lib/ipc'
import type { PluginSummary } from '../../../../types'

const CONTRIBUTION_LABELS: Record<string, string> = {
  blogTemplates: '博客模板(写博工具栏「模板」可见)',
  theme: '主题(设置 → 外观 可选)',
  habitPresets: '习惯预设',
  bookmarkPresets: '网址包',
  pomodoroPresets: '番茄钟预设',
  helpDocs: '帮助文档(帮助模块可见)',
}

interface HabitPreset { name?: unknown; color?: unknown; ruleType?: unknown; ruleDays?: unknown; weeklyTarget?: unknown }
interface BookmarkPreset { name?: unknown; color?: unknown; bookmarks?: unknown }

interface Props {
  plugin: PluginSummary
  onClose: () => void
  onChanged: () => void
}

export function PluginDetailModal({ plugin, onClose, onChanged }: Props) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)

  const toggleEnabled = async () => {
    setBusy(true)
    const r = await pluginSetEnabled(plugin.id, !plugin.enabled)
    setBusy(false)
    if (r.success) { showToast({ type: 'success', message: plugin.enabled ? '插件已禁用' : '插件已启用' }); onChanged() }
    else showToast({ type: 'error', message: r.message || '操作失败' })
  }

  const handleUninstall = async () => {
    if (!confirmDelete) { setConfirmDelete(true); setTimeout(() => setConfirmDelete(false), 3000); return }
    setBusy(true)
    const r = await pluginUninstall(plugin.id)
    setBusy(false)
    if (r.success) { showToast({ type: 'success', message: '插件已卸载' }); onChanged(); onClose() }
    else showToast({ type: 'error', message: r.message || '卸载失败' })
  }

  const importHabitPresets = async () => {
    setBusy(true)
    const r = await pluginGetContribution(plugin.id, 'habitPresets')
    if (!r.ok || !Array.isArray(r.data)) {
      setBusy(false); showToast({ type: 'error', message: r.message || '读取预设失败' }); return
    }
    let ok = 0
    for (const raw of r.data as HabitPreset[]) {
      if (typeof raw?.name !== 'string' || !raw.name.trim()) continue
      try {
        await createHabit({
          name: raw.name.trim(),
          color: typeof raw.color === 'string' ? raw.color : undefined,
          ruleType: raw.ruleType === 'weekdays' || raw.ruleType === 'flexible' ? raw.ruleType : 'daily',
          ruleDays: Array.isArray(raw.ruleDays) ? (raw.ruleDays as number[]) : undefined,
          weeklyTarget: typeof raw.weeklyTarget === 'number' ? raw.weeklyTarget : undefined,
        })
        ok++
      } catch { /* 单条失败继续 */ }
    }
    setBusy(false)
    showToast({ type: ok > 0 ? 'success' : 'error', message: ok > 0 ? `已导入 ${ok} 个习惯,到「习惯打卡」查看` : '没有可导入的预设' })
  }

  const importBookmarkPresets = async () => {
    setBusy(true)
    const r = await pluginGetContribution(plugin.id, 'bookmarkPresets')
    if (!r.ok || !Array.isArray(r.data)) {
      setBusy(false); showToast({ type: 'error', message: r.message || '读取网址包失败' }); return
    }
    // 已有书签 URL 去重(忽略大小写)
    let existing = new Set<string>()
    try {
      const all = await bookmarkGetAll()
      existing = new Set((all?.bookmarks || []).map((b: { url: string }) => b.url.toLowerCase()))
    } catch { /* 忽略,不去重 */ }
    let catOk = 0, bmOk = 0, skipped = 0
    for (const group of r.data as BookmarkPreset[]) {
      const catName = typeof group?.name === 'string' && group.name.trim() ? group.name.trim() : '插件导入'
      const color = typeof group?.color === 'string' ? group.color : undefined
      if (!Array.isArray(group?.bookmarks) || group.bookmarks.length === 0) continue
      try {
        const cat = await createBookmarkCategory({ name: catName, color })
        catOk++
        for (const b of group.bookmarks as { title?: unknown; url?: unknown; description?: unknown }[]) {
          if (typeof b?.title !== 'string' || typeof b?.url !== 'string' || !b.title.trim() || !b.url.trim()) { skipped++; continue }
          const normalized = b.url.trim()
          if (existing.has(normalized.toLowerCase())) { skipped++; continue }
          try {
            await createBookmarkItem({ title: b.title.trim(), url: normalized, description: typeof b.description === 'string' ? b.description : undefined, categoryId: cat.id })
            existing.add(normalized.toLowerCase())
            bmOk++
          } catch { skipped++ }
        }
      } catch { /* 单组失败继续 */ }
    }
    setBusy(false)
    showToast({ type: bmOk > 0 ? 'success' : 'error', message: bmOk > 0 ? `已导入 ${catOk} 个分类、${bmOk} 个书签${skipped > 0 ? `,跳过重复 ${skipped} 个` : ''}` : '没有可导入的书签' })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="w-[440px] max-h-[80vh] flex flex-col bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg shadow-xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border-color)] shrink-0">
          <h3 className="text-[14px] font-semibold text-[var(--text-primary)] flex-1 truncate">{plugin.name}</h3>
          <span className="text-[11px] text-[var(--text-muted)] font-mono">v{plugin.version}</span>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] transition-colors">
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {plugin.broken ? (
            <div className="flex items-center gap-1.5 text-[12px] text-[var(--danger)]">
              <AlertTriangle size={13} />插件数据损坏或缺失,建议卸载后重新安装
            </div>
          ) : (
            <>
              {plugin.description && <p className="text-[12px] text-[var(--text-secondary)] leading-relaxed">{plugin.description}</p>}
              <div className="flex items-center gap-3 text-[11px] text-[var(--text-muted)]">
                {plugin.author && <span>作者:{plugin.author}</span>}
                <span>安装于 {plugin.installedAt.slice(0, 10)}</span>
              </div>

              {/* 启用开关 */}
              <div className="flex items-center justify-between p-3 rounded-md border border-[var(--border-color)]">
                <div>
                  <div className="text-[12px] font-medium text-[var(--text-primary)]">启用插件</div>
                  <div className="text-[11px] text-[var(--text-muted)] mt-0.5">禁用后其内容不再显示,文件保留</div>
                </div>
                <button
                  onClick={toggleEnabled}
                  disabled={busy}
                  className={`relative w-10 h-5 rounded-full transition-colors ${plugin.enabled ? 'bg-[var(--accent)]' : 'bg-[var(--bg-tertiary)] border border-[var(--border-color)]'}`}
                >
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${plugin.enabled ? 'left-[22px]' : 'left-0.5'}`} />
                </button>
              </div>

              {/* 贡献内容 */}
              <div>
                <div className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-2">提供的内容</div>
                <div className="space-y-2">
                  {plugin.contributions.length === 0 && <div className="text-[12px] text-[var(--text-muted)]">无</div>}
                  {plugin.contributions.map(key => (
                    <div key={key} className="flex items-center gap-2 p-2.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-tertiary)]">
                      <CheckCircle2 size={13} className="text-[var(--accent)] shrink-0" />
                      <span className="text-[12px] text-[var(--text-primary)] flex-1">{CONTRIBUTION_LABELS[key] || key}</span>
                      {key === 'habitPresets' && (
                        <button onClick={importHabitPresets} disabled={busy} className="px-2.5 py-1 text-[11px] border border-[var(--border-color)] rounded hover:bg-[var(--bg-hover)] transition-colors text-[var(--text-primary)] disabled:opacity-50">
                          导入
                        </button>
                      )}
                      {key === 'bookmarkPresets' && (
                        <button onClick={importBookmarkPresets} disabled={busy} className="px-2.5 py-1 text-[11px] border border-[var(--border-color)] rounded hover:bg-[var(--bg-hover)] transition-colors text-[var(--text-primary)] disabled:opacity-50">
                          导入
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-[var(--border-color)] shrink-0 flex items-center">
          <button
            onClick={handleUninstall}
            disabled={busy}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-[12px] rounded transition-colors ${
              confirmDelete
                ? 'text-white bg-[var(--danger)]'
                : 'text-[var(--danger)] border border-[var(--danger)]/40 hover:bg-[var(--danger)]/10'
            }`}
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
            {confirmDelete ? '再点一次确认卸载' : '卸载插件'}
          </button>
        </div>
      </div>
    </div>
  )
}
