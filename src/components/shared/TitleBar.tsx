import { useState, useEffect, useRef } from 'react'
import { useSettings } from '../../lib/SettingsContext'
import {
  Minus, Square, X, Copy, Pin, ArrowDownToLine, Loader2, Play,
  Pause, Download, AlertTriangle, RefreshCw, SlidersHorizontal, ExternalLink,
  CalendarCheck2,
} from 'lucide-react'
import {
  useUpdateStore, updateStartupCheck, updateDownload, updatePause, updateCancel, updateInstall,
  updateFailKind, updateFailMessage,
} from '../../lib/updateStore'
import { MarkdownPreview } from './MarkdownPreview'
import { openExternal } from '../../lib/ipc'
import { showToast } from '../../lib/toast'

function showToastSafe(message: string): void {
  showToast({ type: 'info', message })
}

interface TitleBarProps {
  /** 日程打卡侧边栏当前是否激活（内嵌显示中或独立窗口打开中）。用于按钮高亮 */
  dayPanelActive?: boolean
  /** 点击日程打卡侧边栏开关按钮：App 统一处理「脱离态→吸附 / 内嵌态→显示」逻辑 */
  onToggleDayPanel?: () => void
}

export function TitleBar({ dayPanelActive = false, onToggleDayPanel }: TitleBarProps = {}) {
  const { s: settings } = useSettings()
  const badgeEgg = settings.badgeEggActivated
  const [isMaximized, setIsMaximized] = useState(false)
  const [isPinned, setIsPinned] = useState(false)

  // ---- 更新入口:全部状态来自全局 updateStore,与设置页(高级)完全同步 ----
  const upd = useUpdateStore()
  const [panelOpen, setPanelOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const prevPhaseRef = useRef(upd.phase)

  useEffect(() => {
    window.api?.isMaximized()?.then(setIsMaximized)
    window.api?.isAlwaysOnTop()?.then(setIsPinned)
    window.api?.onMaximizeChange?.((v: boolean) => setIsMaximized(v))
    // 启动静默检查:store 内部幂等 + 6s 延迟 + 失败重试 3 次后静默
    updateStartupCheck()
  }, [])

  // 下载完成提示(状态中枢收尾时在标题栏提醒一次)
  useEffect(() => {
    if (prevPhaseRef.current !== 'downloaded' && upd.phase === 'downloaded') {
      showToastSafe(upd.metaMissing
        ? '安装包已就绪,但更新源元数据(latest.yml)缺失,安装可能校验失败'
        : `v${upd.check?.latestVersion || ''} 安装包已就绪,点击标题栏 ▶ 运行安装`)
    }
    prevPhaseRef.current = upd.phase
  }, [upd.phase, upd.metaMissing, upd.check?.latestVersion])

  // 面板外点击关闭
  useEffect(() => {
    if (!panelOpen) return
    const onDown = (e: PointerEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setPanelOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [panelOpen])

  // 入口可见:有新版/下载中/暂停/已下载,或下载失败(检查失败不展示,避免网络抖动打扰)
  const showEntry =
    upd.phase === 'available' || upd.phase === 'downloading' || upd.phase === 'paused' ||
    upd.phase === 'downloaded' || (upd.phase === 'error' && !!upd.check)

  const handleEntryClick = () => {
    // 已下载:点击直接运行安装(快速路径);其余状态展开面板
    if (upd.phase === 'downloaded') { void updateInstall(); return }
    setPanelOpen(o => !o)
  }

  const goSettings = () => {
    setPanelOpen(false)
    window.dispatchEvent(new CustomEvent('settings:open', { detail: { section: 'advanced' } }))
  }

  const entryTitle =
    upd.phase === 'downloading' ? `正在下载 v${upd.check?.latestVersion}… ${upd.progress.percent}%`
    : upd.phase === 'paused' ? `下载已暂停 v${upd.check?.latestVersion},点击继续`
    : upd.phase === 'downloaded' ? `v${upd.check?.latestVersion} 已下载,点击运行安装程序`
    : upd.phase === 'error' ? `更新失败:${upd.error}`
    : `发现新版本 v${upd.check?.latestVersion},点击查看`

  const failKind = updateFailKind(upd.reason)

  function togglePin() {
    const next = !isPinned
    setIsPinned(next)
    window.api?.setAlwaysOnTop(next)
  }

  return (
    <div
      className="relative flex items-center justify-between h-9 bg-[color-mix(in_srgb,var(--bg-tertiary)_72%,transparent)] backdrop-blur-md border-b border-[var(--border-color)] select-none shrink-0 drag-region"
    >
      {/* drag region spacer */}
      <div className="flex-1" />

      {/* 开发版角标：dev server 是 http://，打包版是 file:// */}
      {(typeof location !== 'undefined' && location.protocol === 'http:') || badgeEgg ? (
        <span className="absolute left-3 top-1/2 -translate-y-1/2 px-1.5 py-0.5 text-[10px] font-semibold rounded bg-amber-500/20 text-amber-500 border border-amber-500/40 no-drag select-none">
          {badgeEgg ? 'YHAz' : 'DEV'}
        </span>
      ) : null}

      {/* VS Code 风格居中搜索框，absolute centering */}
      <div className="absolute left-1/2 -translate-x-1/2 no-drag" style={{ width: 'min(100% - 180px, 560px)' }}>
        <div id="titlebar-search" />
      </div>

      {/* 窗口控制按钮 */}
      <div className="flex h-full no-drag">
          {showEntry && (
            <div className="relative h-full" ref={panelRef}>
              <WinBtn onClick={handleEntryClick} title={entryTitle}>
                {upd.phase === 'downloading'
                  ? <span className="relative flex items-center justify-center w-[18px] h-[18px]">
                      <Loader2 size={13} strokeWidth={2} className="animate-spin text-[var(--accent)]" />
                    </span>
                  : upd.phase === 'paused'
                    ? <Pause size={12} strokeWidth={2.5} className="text-[var(--warning)]" />
                    : upd.phase === 'downloaded'
                      ? <Play size={12} strokeWidth={2.5} className="text-[var(--success)]" fill="currentColor" />
                      : upd.phase === 'error'
                        ? <AlertTriangle size={13} strokeWidth={2} className="text-[var(--danger)]" />
                        : <ArrowDownToLine size={14} strokeWidth={2} className="text-[var(--accent)]" />}
                {upd.phase === 'available' && (
                  <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-[var(--warning)] animate-pulse" title="" />
                )}
              </WinBtn>

              {/* 下拉面板:进度/暂停/取消/重试/去设置,状态与设置页同源 */}
              {panelOpen && upd.phase !== 'downloaded' && (
                <div className="absolute right-0 top-full mt-1 w-80 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] shadow-lg z-50 no-drag overflow-hidden">
                  {upd.phase === 'available' && upd.check && (
                    <div className="p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <ArrowDownToLine size={13} className="text-[var(--accent)]" />
                        <span className="text-[13px] font-medium text-[var(--text-primary)]">发现新版本 v{upd.check.latestVersion}</span>
                        <button onClick={() => { void openExternal(upd.check!.releaseUrl).catch(() => {}) }}
                          className="ml-auto text-[var(--text-muted)] hover:text-[var(--accent)]" title="在浏览器打开发布页">
                          <ExternalLink size={12} />
                        </button>
                      </div>
                      <p className="text-[11px] text-[var(--text-muted)] mb-2">当前 v{upd.check.currentVersion} → 新版 v{upd.check.latestVersion}</p>
                      {upd.check.notes && (
                        <details className="mb-2 text-[12px]">
                          <summary className="cursor-pointer text-[var(--text-muted)] hover:text-[var(--text-secondary)]">查看更新内容</summary>
                          <div className="mt-1.5 max-h-40 overflow-y-auto border border-[var(--border-color)] rounded p-2 bg-[var(--bg-secondary)]">
                            <MarkdownPreview content={upd.check.notes} />
                          </div>
                        </details>
                      )}
                      <div className="flex items-center gap-2">
                        <button onClick={() => void updateDownload()}
                          className="flex items-center gap-1 px-2.5 py-1.5 text-[12px] font-medium text-white bg-[var(--accent)] rounded hover:bg-[var(--accent-hover)] transition-colors">
                          <Download size={12} />立即下载
                        </button>
                        <button onClick={goSettings}
                          className="flex items-center gap-1 px-2.5 py-1.5 text-[12px] border border-[var(--border-color)] rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors">
                          <SlidersHorizontal size={12} />去设置页管理
                        </button>
                      </div>
                    </div>
                  )}

                  {(upd.phase === 'downloading' || upd.phase === 'paused') && (
                    <div className="p-3">
                      <div className="h-1.5 bg-[var(--bg-tertiary)] rounded overflow-hidden mb-1.5">
                        <div className={`h-full transition-all ${upd.phase === 'paused' ? 'bg-[var(--warning)]' : 'bg-[var(--accent)]'}`}
                          style={{ width: `${upd.progress.percent}%` }} />
                      </div>
                      <div className="text-[11px] text-[var(--text-muted)] mb-2">
                        {upd.phase === 'paused' ? '已暂停 ' : '正在下载 '}{upd.check?.asset?.name} — {upd.progress.percent}%
                        {upd.progress.totalBytes > 0 && `（${(upd.progress.receivedBytes / 1048576).toFixed(1)} / ${(upd.progress.totalBytes / 1048576).toFixed(1)} MB）`}
                        {upd.phase === 'paused' && ',继续下载将从断点续传'}
                      </div>
                      <div className="flex items-center gap-2">
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
                        <button onClick={goSettings} className="ml-auto text-[11px] text-[var(--text-muted)] hover:text-[var(--accent)]">去设置页</button>
                      </div>
                    </div>
                  )}

                  {upd.phase === 'error' && (
                    <div className="p-3">
                      <div className="flex items-start gap-1.5 mb-2">
                        <AlertTriangle size={13} className="text-[var(--danger)] mt-0.5 shrink-0" />
                        <span className="text-[12px] text-[var(--danger)] leading-relaxed">{updateFailMessage(upd)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => { setPanelOpen(false); void updateDownload() }}
                          className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-white bg-[var(--accent)] rounded hover:bg-[var(--accent-hover)] transition-colors">
                          <RefreshCw size={11} />重试
                        </button>
                        <button onClick={goSettings}
                          className="flex items-center gap-1 px-2.5 py-1 text-[11px] border border-[var(--border-color)] rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors">
                          <SlidersHorizontal size={11} />{failKind === 'integrity' ? '更换镜像重试' : '镜像设置'}
                        </button>
                        {upd.downloadedPath && (
                          <button onClick={() => void updateInstall()}
                            className="ml-auto text-[11px] text-[var(--text-muted)] hover:text-[var(--accent)]">
                            重新运行安装包
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {(upd.phase === 'checking' || upd.phase === 'uptodate' || upd.phase === 'idle') && (
                    <div className="p-3 text-[12px] text-[var(--text-muted)] flex items-center gap-1.5">
                      {upd.phase === 'checking' && <Loader2 size={12} className="animate-spin" />}
                      {upd.phase === 'uptodate' ? '已是最新版本' : '正在检查更新…'}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          <WinBtn
            onClick={onToggleDayPanel ?? (() => {})}
            title="日程与打卡侧边栏 (Ctrl+Alt+S)"
          >
            <CalendarCheck2
              size={14}
              strokeWidth={1.5}
              className={dayPanelActive ? 'text-[var(--accent)]' : ''}
              fill={dayPanelActive ? 'var(--accent)' : 'transparent'}
              fillOpacity={dayPanelActive ? 0.25 : 0}
            />
          </WinBtn>
          <WinBtn onClick={togglePin} title={isPinned ? '取消置顶' : '窗口置顶'}>
            <Pin size={14} strokeWidth={1.5} fill={isPinned ? 'var(--text-primary)' : 'transparent'} />
          </WinBtn>
          <WinBtn onClick={() => window.api?.minimize()} title="最小化"><Minus size={16} strokeWidth={1.5} /></WinBtn>
          <WinBtn onClick={() => window.api?.maximize()} title={isMaximized ? '还原' : '最大化'}>
            {isMaximized ? <Copy size={14} strokeWidth={1.5} /> : <Square size={14} strokeWidth={1.5} />}
          </WinBtn>
          <WinBtn onClick={() => window.api?.close()} title="关闭" isClose>
            <X size={16} strokeWidth={1.5} />
          </WinBtn>
        </div>
    </div>
  )
}

function WinBtn({ children, onClick, title, isClose }: {
  children: React.ReactNode; onClick: () => void; title?: string; isClose?: boolean
}) {
  return (
    <button onClick={onClick} title={title}
      className={`relative flex items-center justify-center w-11 h-full transition-colors duration-100 ${isClose ? 'text-[var(--text-primary)] hover:bg-[var(--danger)] hover:text-white' : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'}`}>
      {children}
    </button>
  )
}
