import { useState, useEffect, useCallback } from 'react'
import {
  Puzzle, RefreshCw, Search, FolderOpen, Download, Loader2,
  CheckCircle2, AlertTriangle, ArrowLeft,
} from 'lucide-react'
import {
  pluginFetchRegistry, pluginInstall, pluginInstallFromFile,
  pluginListInstalled, pluginSetEnabled, pluginUninstall, pluginGetContribution,
  createHabit, createBookmarkCategory, createBookmarkItem, bookmarkGetAll,
} from '../../lib/ipc'
import { showToast } from '../../lib/toast'
import type { PluginSummary, PluginRegistryEntry } from '../../types'

/**
 * 插件管理模块 —— 对标 VS Code 扩展市场布局:
 * 左侧面板(已安装 / 市场两个标签 + 搜索 + 列表),右侧完整详情页。
 */

const CONTRIBUTION_LABELS: Record<string, string> = {
  blogTemplates: '博客模板',
  theme: '主题',
  habitPresets: '习惯预设',
  bookmarkPresets: '网址包',
  pomodoroPresets: '番茄钟预设',
  helpDocs: '帮助文档',
}

const CONTRIBUTION_HINTS: Record<string, string> = {
  blogTemplates: '写博工具栏「模板」弹层中可见',
  theme: '设置 → 外观 的主题列表中可选',
  habitPresets: '点击导入后进入「习惯打卡」',
  bookmarkPresets: '点击导入后进入「网址导航」,自动去重',
  pomodoroPresets: '番茄钟面板的预设按钮组中可见',
  helpDocs: '帮助模块侧栏「插件」分类中可见',
}

type MarketSelection = { kind: 'installed'; plugin: PluginSummary } | { kind: 'market'; plugin: PluginRegistryEntry }

export function PluginsModule() {
  const [tab, setTab] = useState<'installed' | 'market'>('installed')
  const [search, setSearch] = useState('')
  const [installed, setInstalled] = useState<PluginSummary[]>([])
  const [market, setMarket] = useState<PluginRegistryEntry[]>([])
  const [marketLoading, setMarketLoading] = useState(false)
  const [marketError, setMarketError] = useState('')
  const [selected, setSelected] = useState<MarketSelection | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [importedKeys, setImportedKeys] = useState<Set<string>>(new Set())

  const refreshInstalled = useCallback(async () => {
    try { setInstalled(await pluginListInstalled()) } catch { /* 忽略 */ }
  }, [])

  useEffect(() => { refreshInstalled() }, [refreshInstalled])

  const loadMarket = useCallback(async (force = false) => {
    setMarketLoading(true); setMarketError('')
    const r = await pluginFetchRegistry()
    if (r.ok) setMarket(r.plugins)
    else setMarketError(r.message || '插件仓库暂时不可用')
    setMarketLoading(false)
  }, [])

  useEffect(() => { if (tab === 'market' && market.length === 0 && !marketError) loadMarket() }, [tab, market.length, marketError, loadMarket])

  // ---------- 操作 ----------

  const handleInstall = async (p: PluginRegistryEntry) => {
    setBusy(true)
    const r = await pluginInstall(p.downloadUrl)
    setBusy(false)
    if (r.success) {
      showToast({ type: 'success', message: `「${p.name}」安装成功` })
      await refreshInstalled()
      const fresh = (await pluginListInstalled()).find(x => x.id === p.id)
      if (fresh) setSelected({ kind: 'installed', plugin: fresh })
    } else {
      showToast({ type: 'error', message: r.message || '安装失败' })
    }
  }

  const handleInstallFromFile = async () => {
    setBusy(true)
    const r = await pluginInstallFromFile()
    setBusy(false)
    if (r.success) {
      showToast({ type: 'success', message: '插件安装成功' })
      await refreshInstalled()
      setTab('installed')
    } else if (r.message && r.message !== '已取消') {
      showToast({ type: 'error', message: r.message })
    }
  }

  const handleToggle = async (p: PluginSummary) => {
    setBusy(true)
    const r = await pluginSetEnabled(p.id, !p.enabled)
    setBusy(false)
    if (r.success) {
      await refreshInstalled()
      setSelected(s => s?.kind === 'installed' ? { kind: 'installed', plugin: { ...s.plugin, enabled: !p.enabled } } : s)
      // 主题类贡献随启禁刷新(禁用的插件主题立即从设置列表消失)
      import('../../lib/pluginService').then(m => m.ensurePluginThemeStyles()).catch(() => {})
      showToast({ type: 'success', message: p.enabled ? '插件已禁用' : '插件已启用' })
    } else showToast({ type: 'error', message: r.message || '操作失败' })
  }

  const handleUninstall = async (p: PluginSummary) => {
    if (confirmDeleteId !== p.id) { setConfirmDeleteId(p.id); setTimeout(() => setConfirmDeleteId(id => id === p.id ? null : id), 3000); return }
    setBusy(true)
    const r = await pluginUninstall(p.id)
    setBusy(false)
    setConfirmDeleteId(null)
    if (r.success) {
      showToast({ type: 'success', message: '插件已卸载' })
      setSelected(null)
      await refreshInstalled()
      import('../../lib/pluginService').then(m => m.ensurePluginThemeStyles()).catch(() => {})
    } else showToast({ type: 'error', message: r.message || '卸载失败' })
  }

  // ---------- 预设导入 ----------

  const markImported = (id: string, key: string) => {
    setImportedKeys(prev => new Set(prev).add(`${id}:${key}`))
  }

  const importHabitPresets = async (p: PluginSummary) => {
    setBusy(true)
    const r = await pluginGetContribution(p.id, 'habitPresets')
    if (!r.ok || !Array.isArray(r.data)) {
      setBusy(false); showToast({ type: 'error', message: r.message || '读取预设失败' }); return
    }
    let ok = 0
    for (const raw of r.data as Record<string, unknown>[]) {
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
    if (ok > 0) { showToast({ type: 'success', message: `已导入 ${ok} 个习惯` }); markImported(p.id, 'habitPresets') }
    else showToast({ type: 'error', message: '没有可导入的预设' })
  }

  const importBookmarkPresets = async (p: PluginSummary) => {
    setBusy(true)
    const r = await pluginGetContribution(p.id, 'bookmarkPresets')
    if (!r.ok || !Array.isArray(r.data)) {
      setBusy(false); showToast({ type: 'error', message: r.message || '读取网址包失败' }); return
    }
    let existing = new Set<string>()
    try {
      const all = await bookmarkGetAll()
      existing = new Set((all?.bookmarks || []).map((b: { url: string }) => b.url.toLowerCase()))
    } catch { /* 忽略,不去重 */ }
    let catOk = 0, bmOk = 0, skipped = 0
    for (const group of r.data as Record<string, unknown>[]) {
      const catName = typeof group?.name === 'string' && group.name.trim() ? group.name.trim() : '插件导入'
      const color = typeof group?.color === 'string' ? group.color : undefined
      if (!Array.isArray(group?.bookmarks) || group.bookmarks.length === 0) continue
      try {
        const cat = await createBookmarkCategory({ name: catName, color })
        catOk++
        for (const b of group.bookmarks as Record<string, unknown>[]) {
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
    if (bmOk > 0) {
      showToast({ type: 'success', message: `已导入 ${catOk} 个分类、${bmOk} 个书签${skipped > 0 ? `,跳过重复 ${skipped} 个` : ''}` })
      markImported(p.id, 'bookmarkPresets')
    } else showToast({ type: 'error', message: '没有可导入的书签' })
  }

  // ---------- 派生 ----------

  const installedIds: Record<string, string> = Object.fromEntries(installed.map(p => [p.id, p.version]))
  const q = search.trim().toLowerCase()
  const filteredInstalled = installed.filter(p => !q || p.name.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q) || p.id.includes(q))
  const filteredMarket = market.filter(p => !q || p.name.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q) || p.id.includes(q))

  // ---------- 列表项 ----------

  const listItem = (key: string, active: boolean, onClick: () => void, node: React.ReactNode) => (
    <button
      key={key}
      onClick={onClick}
      className={`w-full flex items-start gap-2.5 px-3 py-2.5 text-left border-l-2 transition-colors ${
        active
          ? 'bg-[var(--bg-selected)] border-l-[var(--accent)]'
          : 'border-l-transparent hover:bg-[var(--bg-hover)]'
      }`}
    >
      {node}
    </button>
  )

  const installedItem = (p: PluginSummary) => {
    const active = selected?.kind === 'installed' && selected.plugin.id === p.id
    return listItem(`in-${p.id}`, active, () => setSelected({ kind: 'installed', plugin: p }), (
      <>
        <div className={`shrink-0 mt-0.5 ${p.enabled && !p.broken ? 'text-[var(--accent)]' : 'text-[var(--text-disabled)]'}`}>
          <Puzzle size={15} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className={`text-[13px] font-medium truncate ${p.enabled ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}`}>{p.name}</span>
            <span className="text-[10px] text-[var(--text-disabled)] font-mono shrink-0">v{p.version}</span>
          </div>
          <div className="text-[11px] text-[var(--text-muted)] truncate mt-0.5">
            {p.broken ? '⚠ 数据损坏' : !p.enabled ? '已禁用' : (p.description || p.id)}
          </div>
        </div>
      </>
    ))
  }

  const marketItem = (p: PluginRegistryEntry) => {
    const active = selected?.kind === 'market' && selected.plugin.id === p.id
    const installedVer = installedIds[p.id]
    return listItem(`mk-${p.id}`, active, () => setSelected({ kind: 'market', plugin: p }), (
      <>
        <div className="shrink-0 mt-0.5 text-[var(--accent)]"><Puzzle size={15} /></div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[13px] font-medium text-[var(--text-primary)] truncate">{p.name}</span>
            <span className="text-[10px] text-[var(--text-disabled)] font-mono shrink-0">v{p.version}</span>
            {installedVer && <span className="text-[10px] text-[var(--success)] shrink-0">✓</span>}
          </div>
          <div className="text-[11px] text-[var(--text-muted)] truncate mt-0.5">{p.description || p.id}</div>
        </div>
      </>
    ))
  }

  // ---------- 右侧详情 ----------

  const renderDetail = () => {
    if (!selected) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center text-[var(--text-muted)] gap-3">
          <Puzzle size={40} strokeWidth={1.2} className="text-[var(--text-disabled)]" />
          <p className="text-[13px]">选择一个插件查看详情</p>
        </div>
      )
    }

    if (selected.kind === 'market') {
      const p = selected.plugin
      const installedVer = installedIds[p.id]
      const updatable = installedVer && installedVer !== p.version
      return (
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto px-8 py-8">
            <div className="flex items-start gap-4 mb-5">
              <div className="w-14 h-14 rounded-xl bg-[var(--accent)]/10 flex items-center justify-center shrink-0">
                <Puzzle size={28} className="text-[var(--accent)]" />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-[18px] font-semibold text-[var(--text-primary)] leading-tight">{p.name}</h2>
                <div className="text-[12px] text-[var(--text-muted)] mt-1">
                  {p.author || '未知作者'} · v{p.version}
                  {p.size ? ` · ${(p.size / 1024).toFixed(1)} KB` : ''}
                </div>
              </div>
              <div className="shrink-0">
                {busy ? <Loader2 size={16} className="animate-spin text-[var(--accent)] mt-2" /> : updatable ? (
                  <button onClick={() => handleInstall(p)} className="flex items-center gap-1.5 px-4 py-2 text-[12px] font-medium text-white bg-[var(--accent)] rounded-md hover:bg-[var(--accent-hover)] transition-colors">
                    <Download size={13} />更新
                  </button>
                ) : installedVer ? (
                  <span className="flex items-center gap-1.5 text-[12px] text-[var(--success)] px-2 py-2"><CheckCircle2 size={14} />已安装</span>
                ) : (
                  <button onClick={() => handleInstall(p)} className="flex items-center gap-1.5 px-4 py-2 text-[12px] font-medium text-white bg-[var(--accent)] rounded-md hover:bg-[var(--accent-hover)] transition-colors">
                    <Download size={13} />安装
                  </button>
                )}
              </div>
            </div>

            {p.description && <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed mb-6">{p.description}</p>}

            <SectionTitle>更多信息</SectionTitle>
            <div className="text-[12px] space-y-1.5 text-[var(--text-muted)]">
              <div className="flex"><span className="w-24 shrink-0">插件 ID</span><span className="font-mono text-[var(--text-secondary)]">{p.id}</span></div>
              <div className="flex"><span className="w-24 shrink-0">版本</span><span className="font-mono text-[var(--text-secondary)]">v{p.version}</span></div>
              {p.updatedAt && <div className="flex"><span className="w-24 shrink-0">最近更新</span><span>{p.updatedAt}</span></div>}
              {installedVer && <div className="flex"><span className="w-24 shrink-0">本地状态</span><span className="text-[var(--success)]">已安装 v{installedVer}</span></div>}
            </div>
          </div>
        </div>
      )
    }

    // 已安装详情
    const p = selected.plugin
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-8 py-8">
          <div className="flex items-start gap-4 mb-5">
            <div className={`w-14 h-14 rounded-xl flex items-center justify-center shrink-0 ${p.enabled && !p.broken ? 'bg-[var(--accent)]/10' : 'bg-[var(--bg-tertiary)]'}`}>
              <Puzzle size={28} className={p.enabled && !p.broken ? 'text-[var(--accent)]' : 'text-[var(--text-disabled)]'} />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-[18px] font-semibold text-[var(--text-primary)] leading-tight">{p.name}</h2>
              <div className="text-[12px] text-[var(--text-muted)] mt-1">
                {p.author || '未知作者'} · v{p.version} · 安装于 {p.installedAt.slice(0, 10)}
              </div>
              {p.broken && (
                <div className="flex items-center gap-1.5 text-[12px] text-[var(--danger)] mt-1">
                  <AlertTriangle size={13} />插件数据损坏,建议卸载后重新安装
                </div>
              )}
            </div>
            <button
              onClick={() => handleToggle(p)}
              disabled={busy || p.broken}
              className={`shrink-0 relative w-11 h-6 rounded-full transition-colors disabled:opacity-50 ${p.enabled ? 'bg-[var(--accent)]' : 'bg-[var(--bg-tertiary)] border border-[var(--border-color)]'}`}
              title={p.enabled ? '点击禁用' : '点击启用'}
            >
              <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${p.enabled ? 'left-[22px]' : 'left-0.5'}`} />
            </button>
          </div>

          {p.description && <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed mb-6">{p.description}</p>}

          <SectionTitle>提供的内容</SectionTitle>
          <div className="space-y-2 mb-8">
            {p.broken ? (
              <div className="text-[12px] text-[var(--text-muted)]">无法读取</div>
            ) : p.contributions.length === 0 ? (
              <div className="text-[12px] text-[var(--text-muted)]">无</div>
            ) : p.contributions.map(key => {
              const imported = importedKeys.has(`${p.id}:${key}`)
              const importable = key === 'habitPresets' || key === 'bookmarkPresets'
              return (
                <div key={key} className="flex items-center gap-3 p-3 rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)]">
                  <CheckCircle2 size={14} className="text-[var(--accent)] shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-medium text-[var(--text-primary)]">{CONTRIBUTION_LABELS[key] || key}</div>
                    <div className="text-[11px] text-[var(--text-muted)] mt-0.5">{CONTRIBUTION_HINTS[key] || ''}</div>
                  </div>
                  {importable && (
                    <button
                      onClick={() => key === 'habitPresets' ? importHabitPresets(p) : importBookmarkPresets(p)}
                      disabled={busy || imported}
                      className="shrink-0 px-3 py-1.5 text-[11px] border border-[var(--border-color)] rounded hover:bg-[var(--bg-hover)] transition-colors text-[var(--text-primary)] disabled:opacity-50"
                    >
                      {imported ? '已导入' : '导入'}
                    </button>
                  )}
                </div>
              )
            })}
          </div>

          <SectionTitle>更多信息</SectionTitle>
          <div className="text-[12px] space-y-1.5 text-[var(--text-muted)]">
            <div className="flex"><span className="w-24 shrink-0">插件 ID</span><span className="font-mono text-[var(--text-secondary)]">{p.id}</span></div>
            <div className="flex"><span className="w-24 shrink-0">状态</span><span className={p.enabled ? 'text-[var(--success)]' : ''}>{p.enabled ? '已启用' : '已禁用'}</span></div>
          </div>

          {/* 卸载 */}
          <div className="mt-10 pt-5 border-t border-[var(--border-color)]">
            <button
              onClick={() => handleUninstall(p)}
              disabled={busy}
              className={`flex items-center gap-1.5 px-3.5 py-2 text-[12px] rounded-md transition-colors ${
                confirmDeleteId === p.id
                  ? 'text-white bg-[var(--danger)]'
                  : 'text-[var(--danger)] border border-[var(--danger)]/40 hover:bg-[var(--danger)]/10'
              }`}
            >
              <AlertTriangle size={12} />
              {confirmDeleteId === p.id ? '再点一次确认卸载' : '卸载插件'}
            </button>
            <p className="text-[11px] text-[var(--text-muted)] mt-2">卸载会删除插件文件;已导入的预设与数据不受影响。</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full bg-[var(--bg-primary)]">
      {/* 左侧面板 */}
      <div className="w-[280px] shrink-0 bg-[var(--bg-secondary)] border-r border-[var(--border-color)] flex flex-col">
        {/* 标签切换 */}
        <div className="flex p-2 gap-1 shrink-0">
          {(['installed', 'market'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 px-3 py-1.5 text-[12px] rounded-md transition-colors ${
                tab === t ? 'bg-[var(--bg-selected)] text-[var(--text-primary)]' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]'
              }`}
            >
              {t === 'installed' ? `已安装 (${installed.length})` : '市场'}
            </button>
          ))}
        </div>

        {/* 搜索 + 工具 */}
        <div className="px-2 pb-2 flex gap-1.5 shrink-0">
          <div className="flex-1 flex items-center gap-1.5 px-2.5 py-1.5 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-md">
            <Search size={12} className="text-[var(--text-disabled)] shrink-0" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={tab === 'installed' ? '搜索已安装插件' : '搜索市场插件'}
              className="flex-1 bg-transparent outline-none text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-disabled)]"
            />
          </div>
          {tab === 'market' ? (
            <button onClick={() => loadMarket(true)} disabled={marketLoading} className="p-2 rounded-md border border-[var(--border-color)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] transition-colors" title="刷新市场">
              <RefreshCw size={12} className={marketLoading ? 'animate-spin' : ''} />
            </button>
          ) : (
            <button onClick={handleInstallFromFile} disabled={busy} className="p-2 rounded-md border border-[var(--border-color)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] transition-colors" title="从本地 ZIP 安装">
              <FolderOpen size={12} />
            </button>
          )}
        </div>

        {/* 列表 */}
        <div className="flex-1 overflow-y-auto">
          {tab === 'installed' ? (
            filteredInstalled.length === 0 ? (
              <div className="px-4 py-8 text-center text-[12px] text-[var(--text-muted)] leading-relaxed">
                {q ? '没有匹配的插件' : (
                  <>还没有安装插件<br />
                    <button onClick={() => { setTab('market'); setSearch('') }} className="text-[var(--accent)] hover:underline mt-1">去市场逛逛 →</button>
                  </>
                )}
              </div>
            ) : filteredInstalled.map(installedItem)
          ) : marketLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-[12px] text-[var(--text-muted)]">
              <Loader2 size={14} className="animate-spin" />正在获取…
            </div>
          ) : marketError ? (
            <div className="px-4 py-8 text-center text-[12px] text-[var(--text-muted)] leading-relaxed">
              <AlertTriangle size={16} className="mx-auto mb-2 text-[var(--warning)]" />
              {marketError}
              <div><button onClick={() => loadMarket(true)} className="text-[var(--accent)] hover:underline mt-1">重试</button></div>
            </div>
          ) : filteredMarket.length === 0 ? (
            <div className="px-4 py-8 text-center text-[12px] text-[var(--text-muted)]">{q ? '没有匹配的插件' : '插件仓库还没有上架任何插件'}</div>
          ) : filteredMarket.map(marketItem)}
        </div>

        {/* 底部提示 */}
        <div className="px-3 py-2 border-t border-[var(--border-color)] shrink-0">
          <span className="text-[10px] text-[var(--text-disabled)]">插件来自 GitHub · Lousync/Knowbase-plugins</span>
        </div>
      </div>

      {/* 右侧详情 */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 移动端窄屏时的返回(桌面常驻左侧,不需要) */}
        {selected && (
          <div className="lg:hidden px-4 py-2 border-b border-[var(--border-color)]">
            <button onClick={() => setSelected(null)} className="flex items-center gap-1 text-[12px] text-[var(--text-muted)] hover:text-[var(--text-secondary)]">
              <ArrowLeft size={13} />返回列表
            </button>
          </div>
        )}
        {renderDetail()}
      </div>
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-2.5">{children}</h3>
  )
}
