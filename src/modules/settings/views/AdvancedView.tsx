import { useEffect, useRef, useState } from 'react'
import {
  RotateCcw, Sparkles, RefreshCw, Download, ExternalLink, Play,
  CheckCircle2, AlertTriangle, Loader2, Pause, X, MonitorUp,
} from 'lucide-react'
import { useSettings } from '../../../lib/SettingsContext'
import { getAppVersion, openExternal } from '../../../lib/ipc'
import {
  useUpdateStore, updateCheck, updateDownload, updatePause, updateCancel, updateInstall,
  updateFailKind, updateFailMessage,
} from '../../../lib/updateStore'
import { MarkdownPreview } from '../../../components/shared/MarkdownPreview'

export function AdvancedView() {
  const { s, update } = useSettings()
  const upd = useUpdateStore()
  const mirrorInputRef = useRef<HTMLInputElement | null>(null)
  const [appVersion, setAppVersion] = useState('')

  useEffect(() => { getAppVersion().then(setAppVersion).catch(() => {}) }, [])

  /** 检查失败(无 check 信息)展示原始 message;下载失败按 reason 结构化 */
  const failText = upd.check ? updateFailMessage(upd) : (upd.error || '检查失败,请检查网络')
  const failKind = upd.check ? updateFailKind(upd.reason) : 'network'

  return (
    <div>
      <h2 className="text-[16px] font-semibold text-[var(--text-primary)] mb-1">高级</h2>
      <p className="text-[12px] text-[var(--text-muted)] mb-6">其他偏好设置</p>

      {/* 关于与更新 */}
      <div className="mb-8" data-setting-anchor="advanced.update">
        <h3 className="text-[12px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-3">关于与更新</h3>
        <div className="flex items-center gap-3 mb-3">
          <span className="text-[13px] text-[var(--text-primary)]">当前版本 v{appVersion || '…'}</span>
          <button
            onClick={() => void updateCheck()}
            disabled={upd.phase === 'checking' || upd.phase === 'downloading'}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-[var(--text-primary)] border border-[var(--border-color)] rounded hover:bg-[var(--bg-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {upd.phase === 'checking' ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            {upd.phase === 'checking' ? '检查中…' : '检查更新'}
          </button>
        </div>

        {/* 下载镜像:GitHub 加速代理前缀,失效可随时替换(留空直连) */}
        <div className="mb-4 max-w-md" data-setting-anchor="advanced.mirror">
          <label className="block text-[12px] text-[var(--text-secondary)] mb-1">下载镜像(GitHub 加速代理)</label>
          <input
            ref={mirrorInputRef}
            value={String(s.updateMirror ?? '')}
            onChange={e => update('updateMirror', e.target.value.trim())}
            placeholder="留空 = 直连 GitHub,例:https://gh.dpik.top"
            spellCheck={false}
            className="w-full px-2.5 py-1.5 text-[12px] font-mono bg-[var(--input-bg)] border border-[var(--border-color)] rounded outline-none focus:border-[var(--accent)] text-[var(--text-primary)]"
          />
          <p className="text-[11px] text-[var(--text-muted)] mt-1 leading-relaxed">
            以 <code>镜像/原始地址</code> 前缀方式加速安装包下载;镜像失效时自动回退直连;下载中途更换镜像会自动切换通道并断点续传。常用:{' '}
            {[['gh.dpik.top', 'https://gh.dpik.top'], ['gh-proxy.com', 'https://gh-proxy.com'], ['cdn.gh-proxy.com', 'https://cdn.gh-proxy.com']].map(([name, url], i) => (
              <button key={url} onClick={() => update('updateMirror', url)} className="text-[var(--accent)] hover:underline font-mono" title={`使用 ${url}`}>
                {name}{i < 2 ? ' / ' : ''}
              </button>
            ))}
          </p>
        </div>

        {upd.phase === 'uptodate' && (
          <div className="flex items-center gap-1.5 text-[12px] text-[var(--success)]">
            <CheckCircle2 size={13} />已是最新版本
          </div>
        )}

        {upd.phase === 'error' && (
          <div className="border border-[var(--danger)]/40 rounded-lg p-3 max-w-md bg-[var(--bg-secondary)]">
            <div className="flex items-start gap-1.5">
              <AlertTriangle size={13} className="text-[var(--danger)] mt-0.5 shrink-0" />
              <span className="text-[12px] text-[var(--danger)] leading-relaxed">{failText}</span>
            </div>
            {upd.check && (
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <button onClick={() => void updateDownload()}
                  className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-white bg-[var(--accent)] rounded hover:bg-[var(--accent-hover)] transition-colors">
                  <RefreshCw size={11} />{failKind === 'integrity' ? '重新下载' : '重试'}
                </button>
                <button onClick={() => {
                  mirrorInputRef.current?.focus()
                  mirrorInputRef.current?.select()
                }}
                  className="flex items-center gap-1 px-2.5 py-1 text-[11px] border border-[var(--border-color)] rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors">
                  <MonitorUp size={11} />更换镜像重试
                </button>
                <span className="text-[11px] text-[var(--text-muted)]">换镜像后点「重新下载」即可断点续传</span>
              </div>
            )}
          </div>
        )}

        {(upd.phase === 'available' || upd.phase === 'downloading' || upd.phase === 'paused' || upd.phase === 'downloaded') && upd.check && (
          <div className="border border-[var(--border-color)] rounded-lg p-3 max-w-md bg-[var(--bg-secondary)]">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles size={13} className="text-[var(--accent)]" />
              <span className="text-[13px] font-medium text-[var(--text-primary)]">发现新版本 v{upd.check.latestVersion}</span>
              <button
                onClick={() => openExternal(upd.check!.releaseUrl).catch(() => {})}
                className="ml-auto flex items-center gap-1 text-[11px] text-[var(--accent)] hover:underline"
              >
                <ExternalLink size={11} />发布页
              </button>
            </div>

            {(upd.phase === 'downloading' || upd.phase === 'paused') ? (
              <div>
                <div className="h-1.5 bg-[var(--bg-tertiary)] rounded overflow-hidden mb-1.5">
                  <div className={`h-full transition-all ${upd.phase === 'paused' ? 'bg-[var(--warning)]' : 'bg-[var(--accent)]'}`} style={{ width: `${upd.progress.percent}%` }} />
                </div>
                <div className="text-[11px] text-[var(--text-muted)]">
                  {upd.phase === 'paused' ? '已暂停 ' : '正在下载 '}{upd.check.asset?.name} — {upd.progress.percent}%
                  {upd.progress.totalBytes > 0 && `（${(upd.progress.receivedBytes / 1048576).toFixed(1)} / ${(upd.progress.totalBytes / 1048576).toFixed(1)} MB）`}
                  {upd.phase === 'paused' && ',继续下载将从断点续传'}
                </div>
                <div className="flex items-center gap-2 mt-2">
                  {upd.phase === 'downloading' ? (
                    <button onClick={() => void updatePause()}
                      className="flex items-center gap-1 px-2.5 py-1 text-[11px] border border-[var(--border-color)] rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors">
                      <Pause size={11} />暂停
                    </button>
                  ) : (
                    <button onClick={() => void updateDownload()}
                      className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-white bg-[var(--accent)] rounded hover:bg-[var(--accent-hover)] transition-colors">
                      <Download size={11} />继续下载
                    </button>
                  )}
                  <button onClick={() => void updateCancel()}
                    className="flex items-center gap-1 px-2.5 py-1 text-[11px] border border-[var(--border-color)] rounded text-[var(--text-secondary)] hover:text-red-400 hover:bg-[var(--bg-hover)] transition-colors">
                    <X size={11} />取消下载
                  </button>
                </div>
              </div>
            ) : upd.phase === 'downloaded' ? (
              <div>
                <div className="flex items-center gap-1.5 text-[12px] text-[var(--success)] mb-2">
                  <CheckCircle2 size={13} />安装包已下载到系统「下载」目录
                </div>
                {upd.metaMissing && (
                  <div className="flex items-start gap-1.5 text-[11px] text-[var(--warning)] mb-2 leading-relaxed">
                    <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                    更新源文件不完整:latest.yml 缺失,已按文件大小完成校验;若安装时提示 integrity check failed,请到发布页手动下载
                  </div>
                )}
                <button
                  onClick={() => void updateInstall()}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-white bg-[var(--accent)] rounded-md hover:bg-[var(--accent-hover)] transition-colors"
                >
                  <Play size={12} />运行安装程序
                </button>
                <p className="text-[11px] text-[var(--text-muted)] mt-2">安装完成后重新打开应用即完成更新;旧安装包将在更新成功后自动清理</p>
              </div>
            ) : (
              <div>
                {upd.check.asset ? (
                  <button
                    onClick={() => void updateDownload()}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-white bg-[var(--accent)] rounded-md hover:bg-[var(--accent-hover)] transition-colors mb-2"
                  >
                    <Download size={12} />下载更新
                  </button>
                ) : (
                  <p className="text-[11px] text-[var(--text-muted)] mb-2">该版本未附带安装包，请前往发布页手动下载</p>
                )}
                {upd.check.notes && (
                  <details className="text-[12px]">
                    <summary className="cursor-pointer text-[var(--text-muted)] hover:text-[var(--text-secondary)]">查看更新内容</summary>
                    <div className="mt-2 max-h-48 overflow-y-auto border border-[var(--border-color)] rounded p-2 bg-[var(--bg-primary)]">
                      <MarkdownPreview content={upd.check.notes} />
                    </div>
                  </details>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Zoom */}
      <div className="mb-8" data-setting-anchor="advanced.zoom">
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
      <div className="mb-8" data-setting-anchor="advanced.deleteConfirm">
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
      <div className="mb-8" data-setting-anchor="advanced.onboarding">
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
      <div data-setting-anchor="advanced.autosave">
        <h3 className="text-[12px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-3">自动保存</h3>
        <div className="text-[13px] text-[var(--text-muted)]">
          编辑器将在停止输入 {s.autoSaveDebounceMs / 1000} 秒后自动保存
        </div>
      </div>
    </div>
  )
}
