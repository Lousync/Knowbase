import { useState, useEffect, useRef } from 'react'
import { useSettings } from '../../lib/SettingsContext'
import {
  X, Pin, ArrowDownToLine, Loader2, Play,
  Pause, Download, AlertTriangle, RefreshCw, SlidersHorizontal, ExternalLink,
  CalendarCheck2,
} from 'lucide-react'
import {
  useUpdateStore, updateStartupCheck, updateDownload, updatePause, updateCancel, updateInstall,
  updateFailKind, updateFailMessage,
} from '../../lib/updateStore'
import { MarkdownPreview } from './MarkdownPreview'
import { openExternal, edgeResizeStart, edgeResizeEnd } from '../../lib/ipc'
import { showToast } from '../../lib/toast'

function showToastSafe(message: string): void {
  showToast({ type: 'info', message })
}

interface TitleBarProps {
  /** 日程打卡侧边栏当前是否激活（内嵌显示中或独立窗口打开中）。用于按钮高亮 */
  dayPanelActive?: boolean
  /** 点击日程打卡侧边栏开关按钮：App 统一处理「脱离态→吸附 / 内嵌态→显示」逻辑 */
  onToggleDayPanel?: () => void
  /** 抽屉面板当前实际占宽（0 = 收起）。搜索框以此为偏移锚定主内容区中心，外扩时不漂移 */
  drawerWidth?: number
}

export function TitleBar({ dayPanelActive = false, onToggleDayPanel, drawerWidth = 0 }: TitleBarProps = {}) {
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

  // UI 优化条目1.7（Q2 拍板）：最大化后拖标题栏空白处 = 恢复窗口 + 跟随移动。
  // 透明无埋窗口在最大化态的 drag-region 原生行为不可靠，统一并入 edgeResize 协议：
  // overlay（no-drag，压在空白区之上、交互控件之下）mousedown → 主进程 edge='move' 恢复+跟随；
  // 双击 = 还原/最大化 toggle（Edge 同款语义）。渲染层 mouseup 收尾跟随循环。
  const onMaxTitleDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    void edgeResizeStart('move').catch(() => {})
    const up = () => { void edgeResizeEnd().catch(() => {}); window.removeEventListener('mouseup', up) }
    window.addEventListener('mouseup', up)
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
      className="relative z-[75] flex items-center h-9 bg-[color-mix(in_srgb,var(--bg-tertiary)_72%,transparent)] backdrop-blur-md border-b border-[var(--border-color)] select-none shrink-0 drag-region"
    >
      {/* 左：macOS 红绿灯窗控 + 开发版角标 + 窗口级操作（锚定主内容区，不随抽屉外扩漂移） */}
      <div className="relative z-10 flex items-center h-full pl-3 no-drag group/traffic">
        <TrafficLight color="#ff5f57" title="关闭" onClick={() => window.api?.close()}>
          <svg width="10" height="10" viewBox="0 0 8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none">
            <path d="M1.7 1.7 L6.3 6.3 M6.3 1.7 L1.7 6.3" />
          </svg>
        </TrafficLight>
        <TrafficLight color="#febc2e" title="最小化" onClick={() => window.api?.minimize()}>
          <svg width="10" height="10" viewBox="0 0 8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none">
            <path d="M1.7 4 H6.3" />
          </svg>
        </TrafficLight>
        <TrafficLight color="#28c840" title={isMaximized ? '还原' : '最大化'} onClick={() => window.api?.maximize()}>
          {isMaximized ? (
            <svg width="10" height="10" viewBox="0 0 8 8" fill="currentColor">
              <path d="M1 3.2 L3.2 1 L3.2 3.2 Z" />
              <path d="M7 4.8 L4.8 7 L4.8 4.8 Z" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 8 8" fill="currentColor">
              <path d="M1 1 L4 1 L1 4 Z" />
              <path d="M7 7 L4 7 L7 4 Z" />
            </svg>
          )}
        </TrafficLight>

        {/* 开发版角标：dev server 是 http://，打包版是 file:// */}
        {(typeof location !== 'undefined' && location.protocol === 'http:') || badgeEgg ? (
          <span className="ml-2.5 px-1.5 py-0.5 text-[10px] font-semibold rounded bg-amber-500/20 text-amber-500 border border-amber-500/40 select-none">
            {badgeEgg ? 'YHAz' : 'DEV'}
          </span>
        ) : null}

        {/* UI 打磨点1：仓库切换器已迁至编辑器侧栏底部（editor/index.tsx treeColumn） */}

        {/* 窗口级操作：更新入口 / 日程侧边栏开关 / 置顶 */}
        {showEntry && (
          <div className="relative h-full ml-1" ref={panelRef}>
            <WinBtn onClick={handleEntryClick} title={entryTitle} className="w-9">
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
                <div className="absolute left-0 top-full mt-1 w-80 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] shadow-lg z-50 no-drag overflow-hidden">
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
            className="w-9"
          >
            <CalendarCheck2
              size={14}
              strokeWidth={1.5}
              className={dayPanelActive ? 'text-[var(--accent)]' : ''}
              fill={dayPanelActive ? 'var(--accent)' : 'transparent'}
              fillOpacity={dayPanelActive ? 0.25 : 0}
            />
          </WinBtn>
          <WinBtn onClick={togglePin} title={isPinned ? '取消置顶' : '窗口置顶'} className="w-9">
            <Pin size={14} strokeWidth={1.5} fill={isPinned ? 'var(--text-primary)' : 'transparent'} />
          </WinBtn>
        </div>

      {/* VS Code 风格居中搜索框：锚定主内容区中心（左移 drawerWidth/2），抽屉外扩时纹丝不动；
          宽度同步扣除 drawerWidth，展开前后保持不变 */}
      <div
        className="absolute -translate-x-1/2 no-drag z-10"
        style={{ left: `calc(50% - ${drawerWidth / 2}px)`, width: `min(100% - ${180 + drawerWidth}px, 560px)` }}
      >
        <div id="titlebar-search" />
      </div>
      {/* UI 优化条目1.7：最大化态顶栏拖拽恢复 overlay（空白区接管，控件 z-10 保持可点；双击 toggle 还原） */}
      {isMaximized && (
        <div className="absolute inset-0 no-drag z-0" onMouseDown={onMaxTitleDown} onDoubleClick={() => window.api?.maximize()} />
      )}
    </div>
  )
}

function WinBtn({ children, onClick, title, className = '' }: {
  children: React.ReactNode; onClick: () => void; title?: string; className?: string
}) {
  return (
    <button onClick={onClick} title={title}
      className={`relative flex items-center justify-center h-full transition-colors duration-100 text-[var(--text-primary)] hover:bg-[var(--bg-hover)] ${className || 'w-11'}`}>
      {children}
    </button>
  )
}

/** macOS 红绿灯窗控：16px 彩色圆点，hover 组内点亮符号、单键加深 */
function TrafficLight({ color, title, onClick, children }: {
  color: string; title?: string; onClick: () => void; children?: React.ReactNode
}) {
  return (
    <button onClick={onClick} title={title}
      className="flex items-center justify-center w-5 h-5 transition-[filter] duration-100 hover:brightness-90">
      <span className="flex items-center justify-center w-4 h-4 rounded-full text-black/60"
        style={{ backgroundColor: color }}>
        <span className="flex items-center justify-center opacity-0 group-hover/traffic:opacity-100 transition-opacity duration-100">
          {children}
        </span>
      </span>
    </button>
  )
}
