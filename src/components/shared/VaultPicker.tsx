import { useEffect, useState } from 'react'
import { ArrowLeft, FolderOpen, Plus, Sparkles } from 'lucide-react'
import { getAppVersion, openDirDialog, workspaceCreateVault } from '../../lib/ipc'
import { openVaultWithGuide } from '../../lib/vaultOpen'
import { showToast } from '../../lib/toast'

type VaultResult = { rootId: string; name: string; path: string; error?: string } | null

/**
 * 首启仓库选择（Obsidian 式，docs/agent 无关）：新手引导前置步骤。
 * 快速开始（文档目录默认仓）/ 新建仓库（名称+位置）/ 打开本地文件夹，完成或跳过后进入新手引导。
 * 完成后广播 vault:changed——编辑器挂载早于本流程，需据此自动挂载新仓库。
 */
export function VaultPicker({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<'home' | 'create'>('home')
  const [version, setVersion] = useState('')
  const [name, setName] = useState('')
  const [parentPath, setParentPath] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => { void getAppVersion().then(setVersion).catch(() => {}) }, [])

  const finish = () => {
    window.dispatchEvent(new Event('vault:changed'))
    onDone()
  }

  const apply = (res: VaultResult): boolean => {
    if (!res) return false // 用户取消对话框
    if (res.error) { showToast({ type: 'error', message: res.error }); return false }
    finish()
    return true
  }

  const quickStart = async (): Promise<void> => {
    setBusy(true)
    try { apply(await workspaceCreateVault('我的仓库', '__default__')) } finally { setBusy(false) }
  }

  const openExisting = async (): Promise<void> => {
    setBusy(true)
    try {
      // D7：非仓库目录在 openVaultWithGuide 内弹「初始化为仓库？」确认，取消则不建
      const opened = await openVaultWithGuide()
      if (opened) finish()
    } finally {
      setBusy(false)
    }
  }

  const browse = async (): Promise<void> => {
    const dir = await openDirDialog()
    if (dir) setParentPath(dir)
  }

  const doCreate = async (): Promise<void> => {
    const trimmed = name.trim()
    if (!trimmed) { showToast({ type: 'warning', message: '请先给仓库起一个名字' }); return }
    setBusy(true)
    try { apply(await workspaceCreateVault(trimmed, parentPath ?? '__default__')) } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-[95] bg-[var(--bg-primary)] flex items-center justify-center select-none">
      <div className="w-full max-w-[620px] mx-6 -mt-8">
        {/* 品牌区（Obsidian 式：图标 + 名称 + 版本） */}
        <div className="text-center mb-9">
          <div className="w-16 h-16 rounded-2xl bg-[var(--accent)]/10 flex items-center justify-center mx-auto mb-4">
            <Sparkles size={30} className="text-[var(--accent)]" />
          </div>
          <h1 className="text-[24px] font-semibold text-[var(--text-primary)]">Knowbase</h1>
          {version && <p className="text-[12px] text-[var(--text-muted)] mt-1">版本 {version}</p>}
        </div>

        {mode === 'home' ? (
          <div className="vault-picker-step">
            <button
              onClick={() => void quickStart()}
              disabled={busy}
              className="w-full py-2.5 text-[13px] font-medium text-white bg-[var(--accent)] rounded-md hover:bg-[var(--accent-hover)] transition-colors mb-7 disabled:opacity-60"
            >
              快速开始
            </button>
            <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] px-5 divide-y divide-[var(--border-color)]">
              <VaultRow
                icon={<Plus size={15} />}
                title="新建仓库"
                desc="在指定文件夹下创建一个新的仓库。"
                actionLabel="创建"
                onAction={() => setMode('create')}
              />
              <VaultRow
                icon={<FolderOpen size={15} />}
                title="打开本地仓库"
                desc="将一个本地文件夹作为仓库在 Knowbase 中打开。"
                actionLabel="打开"
                secondary
                onAction={() => void openExisting()}
              />
            </div>
            <div className="text-center mt-7">
              <button
                onClick={onDone}
                className="text-[12px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
              >
                暂不设置，稍后在编辑区打开仓库
              </button>
            </div>
          </div>
        ) : (
          <div className="vault-picker-step">
            <button
              onClick={() => setMode('home')}
              className="flex items-center gap-1 text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors mb-1"
            >
              <ArrowLeft size={13} />返回
            </button>
            <h2 className="text-[15px] font-semibold text-[var(--text-primary)] mb-5">创建本地仓库</h2>
            <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] px-5 divide-y divide-[var(--border-color)]">
              <div className="flex items-center justify-between gap-4 py-4">
                <div>
                  <div className="text-[13px] font-medium text-[var(--text-primary)]">仓库名称</div>
                  <div className="text-[11.5px] text-[var(--text-muted)] mt-0.5">给新仓库起一个名字</div>
                </div>
                <input
                  autoFocus
                  value={name}
                  onChange={e => setName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') void doCreate() }}
                  placeholder="仓库名称"
                  maxLength={60}
                  className="w-[220px] px-2.5 py-1.5 rounded-md border border-[var(--border-color)] bg-[var(--input-bg)] text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                />
              </div>
              <div className="flex items-center justify-between gap-4 py-4">
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-[var(--text-primary)]">仓库位置</div>
                  <div className="text-[11.5px] text-[var(--text-muted)] mt-0.5 truncate" title={parentPath ?? undefined}>
                    {parentPath ?? '默认（文档目录）'}
                  </div>
                </div>
                <button
                  onClick={() => void browse()}
                  className="shrink-0 px-4 py-1.5 text-[12px] text-[var(--text-secondary)] border border-[var(--border-color)] rounded-md hover:bg-[var(--bg-hover)] transition-colors"
                >
                  浏览
                </button>
              </div>
            </div>
            <div className="text-center mt-7">
              <button
                onClick={() => void doCreate()}
                disabled={busy || !name.trim()}
                className="px-7 py-2 text-[13px] font-medium text-white bg-[var(--accent)] rounded-md hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-50"
              >
                创建
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function VaultRow({ icon, title, desc, actionLabel, onAction, secondary = false }: {
  icon: React.ReactNode
  title: string
  desc: string
  actionLabel: string
  onAction: () => void
  secondary?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-4">
      <div className="flex items-start gap-3 min-w-0">
        <span className="shrink-0 mt-0.5 text-[var(--accent)]">{icon}</span>
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-[var(--text-primary)]">{title}</div>
          <div className="text-[11.5px] text-[var(--text-muted)] mt-0.5">{desc}</div>
        </div>
      </div>
      <button
        onClick={onAction}
        className={`shrink-0 px-5 py-1.5 text-[12px] font-medium rounded-md transition-colors ${
          secondary
            ? 'text-[var(--text-secondary)] border border-[var(--border-color)] hover:bg-[var(--bg-hover)]'
            : 'text-white bg-[var(--accent)] hover:bg-[var(--accent-hover)]'
        }`}
      >
        {actionLabel}
      </button>
    </div>
  )
}
