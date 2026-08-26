import { useEffect, useState } from 'react'
import {
  RotateCcw, Sparkles, RefreshCw, Download, ExternalLink, Play,
  CheckCircle2, AlertTriangle, Loader2,
} from 'lucide-react'
import { useSettings } from '../../../lib/SettingsContext'
import {
  getAppVersion, checkForUpdate, downloadUpdate, installUpdate,
  onUpdateDownloadProgress, openExternal,
} from '../../../lib/ipc'
import { MarkdownPreview } from '../../../components/shared/MarkdownPreview'

type UpdateState = 'idle' | 'checking' | 'uptodate' | 'available' | 'downloading' | 'downloaded' | 'error'

interface UpdateResult {
  ok: boolean
  hasUpdate: boolean
  currentVersion: string
  latestVersion: string
  releaseUrl: string
  notes: string
  asset: { name: string; url: string; size: number } | null
  message?: string
}

export function AdvancedView() {
  const { s, update } = useSettings()

  // ---- 检查更新 ----
  const [appVersion, setAppVersion] = useState('')
  const [updState, setUpdState] = useState<UpdateState>('idle')
  const [updResult, setUpdResult] = useState<UpdateResult | null>(null)
  const [updError, setUpdError] = useState('')
  const [progress, setProgress] = useState({ percent: 0, receivedBytes: 0, totalBytes: 0 })
  const [downloadedPath, setDownloadedPath] = useState('')

  useEffect(() => { getAppVersion().then(setAppVersion) }, [])
  useEffect(() => onUpdateDownloadProgress(p => setProgress(p)), [])

  const handleCheckUpdate = async () => {
    setUpdState('checking'); setUpdError('')
    try {
      const r = await checkForUpdate()
      setUpdResult(r)
      if (!r.ok) { setUpdError(r.message || '检查失败,请检查网络'); setUpdState('error') }
      else setUpdState(r.hasUpdate ? 'available' : 'uptodate')
    } catch (e: any) {
      setUpdError(e?.message || '检查失败,请检查网络'); setUpdState('error')
    }
  }

  const handleDownload = async () => {
    if (!updResult?.asset) return
    setUpdState('downloading')
    setProgress({ percent: 0, receivedBytes: 0, totalBytes: updResult.asset.size })
    const r = await downloadUpdate(updResult.asset.url, updResult.asset.name)
    if (r.success && r.filePath) { setDownloadedPath(r.filePath); setUpdState('downloaded') }
    else { setUpdError(r.message || '下载失败'); setUpdState('error') }
  }

  const handleInstall = async () => {
    const r = await installUpdate(downloadedPath)
    if (!r.success) { setUpdError(r.message || '启动安装程序失败'); setUpdState('error') }
  }

  return (
    <div>
      <h2 className="text-[16px] font-semibold text-[var(--text-primary)] mb-1">高级</h2>
      <p className="text-[12px] text-[var(--text-muted)] mb-6">其他偏好设置</p>

      {/* 关于与更新 */}
      <div className="mb-8">
        <h3 className="text-[12px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-3">关于与更新</h3>
        <div className="flex items-center gap-3 mb-3">
          <span className="text-[13px] text-[var(--text-primary)]">当前版本 v{appVersion || '…'}</span>
          <button
            onClick={handleCheckUpdate}
            disabled={updState === 'checking' || updState === 'downloading'}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-[var(--text-primary)] border border-[var(--border-color)] rounded hover:bg-[var(--bg-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {updState === 'checking' ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            {updState === 'checking' ? '检查中…' : '检查更新'}
          </button>
        </div>

        {/* 下载镜像:GitHub 加速代理前缀,失效可随时替换(留空直连) */}
        <div className="mb-4 max-w-md">
          <label className="block text-[12px] text-[var(--text-secondary)] mb-1">下载镜像(GitHub 加速代理)</label>
          <input
            value={String(s.updateMirror ?? '')}
            onChange={e => update('updateMirror', e.target.value.trim())}
            placeholder="留空 = 直连 GitHub,例:https://gh.dpik.top"
            spellCheck={false}
            className="w-full px-2.5 py-1.5 text-[12px] font-mono bg-[var(--input-bg)] border border-[var(--border-color)] rounded outline-none focus:border-[var(--accent)] text-[var(--text-primary)]"
          />
          <p className="text-[11px] text-[var(--text-muted)] mt-1 leading-relaxed">
            以 <code>镜像/原始地址</code> 前缀方式加速安装包下载;镜像失效时自动回退直连。常用:{' '}
            {[['gh.dpik.top', 'https://gh.dpik.top'], ['gh-proxy.com', 'https://gh-proxy.com'], ['cdn.gh-proxy.com', 'https://cdn.gh-proxy.com']].map(([name, url], i) => (
              <button key={url} onClick={() => update('updateMirror', url)} className="text-[var(--accent)] hover:underline font-mono" title={`使用 ${url}`}>
                {name}{i < 2 ? ' / ' : ''}
              </button>
            ))}
          </p>
        </div>

        {updState === 'uptodate' && (
          <div className="flex items-center gap-1.5 text-[12px] text-[var(--success)]">
            <CheckCircle2 size={13} />已是最新版本
          </div>
        )}
        {updState === 'error' && (
          <div className="flex items-center gap-1.5 text-[12px] text-[var(--danger)]">
            <AlertTriangle size={13} />{updError}
          </div>
        )}

        {(updState === 'available' || updState === 'downloading' || updState === 'downloaded') && updResult && (
          <div className="border border-[var(--border-color)] rounded-lg p-3 max-w-md bg-[var(--bg-secondary)]">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles size={13} className="text-[var(--accent)]" />
              <span className="text-[13px] font-medium text-[var(--text-primary)]">发现新版本 v{updResult.latestVersion}</span>
              <button
                onClick={() => openExternal(updResult.releaseUrl).catch(() => {})}
                className="ml-auto flex items-center gap-1 text-[11px] text-[var(--accent)] hover:underline"
              >
                <ExternalLink size={11} />发布页
              </button>
            </div>

            {updState === 'downloading' ? (
              <div>
                <div className="h-1.5 bg-[var(--bg-tertiary)] rounded overflow-hidden mb-1.5">
                  <div className="h-full bg-[var(--accent)] transition-all" style={{ width: `${progress.percent}%` }} />
                </div>
                <div className="text-[11px] text-[var(--text-muted)]">
                  正在下载 {updResult.asset?.name} — {progress.percent}%
                  {progress.totalBytes > 0 && `（${(progress.receivedBytes / 1048576).toFixed(1)} / ${(progress.totalBytes / 1048576).toFixed(1)} MB）`}
                </div>
              </div>
            ) : updState === 'downloaded' ? (
              <div>
                <div className="flex items-center gap-1.5 text-[12px] text-[var(--success)] mb-2">
                  <CheckCircle2 size={13} />安装包已下载到系统「下载」目录
                </div>
                <button
                  onClick={handleInstall}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-white bg-[var(--accent)] rounded-md hover:bg-[var(--accent-hover)] transition-colors"
                >
                  <Play size={12} />运行安装程序
                </button>
                <p className="text-[11px] text-[var(--text-muted)] mt-2">安装完成后重新打开应用即完成更新</p>
              </div>
            ) : (
              <div>
                {updResult.asset ? (
                  <button
                    onClick={handleDownload}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-white bg-[var(--accent)] rounded-md hover:bg-[var(--accent-hover)] transition-colors mb-2"
                  >
                    <Download size={12} />下载更新
                  </button>
                ) : (
                  <p className="text-[11px] text-[var(--text-muted)] mb-2">该版本未附带安装包，请前往发布页手动下载</p>
                )}
                {updResult.notes && (
                  <details className="text-[12px]">
                    <summary className="cursor-pointer text-[var(--text-muted)] hover:text-[var(--text-secondary)]">查看更新内容</summary>
                    <div className="mt-2 max-h-48 overflow-y-auto border border-[var(--border-color)] rounded p-2 bg-[var(--bg-primary)]">
                      <MarkdownPreview content={updResult.notes} />
                    </div>
                  </details>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Zoom */}
      <div className="mb-8">
        <h3 className="text-[12px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-3">缩放</h3>
        <div className="flex items-center gap-4">
          <span className="text-[13px] text-[var(--text-primary)]">
            当前缩放：{Math.round(s.zoom * 100)}%
          </span>
          <button
            onClick={() => { update('zoom', 1.0); document.documentElement.style.fontSize = '16px' }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-[var(--text-primary)] border border-[var(--border-color)] rounded hover:bg-[var(--bg-hover)] transition-colors"
          >
            <RotateCcw size={12} />
            重置缩放
          </button>
        </div>
      </div>

      {/* Delete confirmation */}
      <div className="mb-8">
        <h3 className="text-[12px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-3">删除确认</h3>
        <div className="space-y-2.5 max-w-sm">
          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-[13px] text-[var(--text-primary)]">跳过博客删除确认对话框</span>
            <input type="checkbox" checked={s.skipDeleteConfirm_blog}
              onChange={() => update('skipDeleteConfirm_blog', !s.skipDeleteConfirm_blog)}
              className="accent-[var(--accent)]" />
          </label>
          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-[13px] text-[var(--text-primary)]">跳过知识库页面删除确认对话框</span>
            <input type="checkbox" checked={s.skipDeleteConfirm_knowledge}
              onChange={() => update('skipDeleteConfirm_knowledge', !s.skipDeleteConfirm_knowledge)}
              className="accent-[var(--accent)]" />
          </label>
          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-[13px] text-[var(--text-primary)]">跳过目录/笔记本删除确认对话框</span>
            <input type="checkbox" checked={s.skipDeleteConfirm_knowledgeCategory}
              onChange={() => update('skipDeleteConfirm_knowledgeCategory', !s.skipDeleteConfirm_knowledgeCategory)}
              className="accent-[var(--accent)]" />
          </label>
          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-[13px] text-[var(--text-primary)]">跳过章节删除确认对话框</span>
            <input type="checkbox" checked={s.skipDeleteConfirm_chapter}
              onChange={() => update('skipDeleteConfirm_chapter', !s.skipDeleteConfirm_chapter)}
              className="accent-[var(--accent)]" />
          </label>
        </div>
      </div>

      {/* Onboarding */}
      <div className="mb-8">
        <h3 className="text-[12px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-3">新手引导</h3>
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('onboarding:show'))}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-[var(--text-primary)] border border-[var(--border-color)] rounded hover:bg-[var(--bg-hover)] transition-colors"
        >
          <Sparkles size={12} />
          重新查看新手引导
        </button>
      </div>

      {/* Auto-save info */}
      <div>
        <h3 className="text-[12px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-3">自动保存</h3>
        <div className="text-[13px] text-[var(--text-muted)]">
          编辑器将在停止输入 {s.autoSaveDebounceMs / 1000} 秒后自动保存
        </div>
      </div>
    </div>
  )
}
