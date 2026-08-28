import { useState, useEffect, useRef } from 'react'
import { Minus, Square, X, Copy, Pin, Lock, ArrowDownToLine, Loader2, Play } from 'lucide-react'
import { checkForUpdate, downloadUpdate, installUpdate, onUpdateDownloadProgress } from '../../lib/ipc'
import { showToast } from '../../lib/toast'

function showToastSafe(message: string): void {
  showToast({ type: 'info', message })
}

export function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false)
  const [isPinned, setIsPinned] = useState(false)

  // ---- 更新徽章:启动后静默检查一�?有新版显�?�?按钮,点击直接开始下�?----
  type UpdState = 'hidden' | 'available' | 'downloading' | 'downloaded'
  const [updState, setUpdState] = useState<UpdState>('hidden')
  const [asset, setAsset] = useState<{ url: string; name: string; size?: number } | null>(null)
  const [latestVersion, setLatestVersion] = useState('')
  const [progress, setProgress] = useState(0)
  const downloadedPathRef = useRef<string>('')
  const busyRef = useRef(false)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    window.api?.isMaximized()?.then(setIsMaximized)
    window.api?.isAlwaysOnTop()?.then(setIsPinned)
    window.api?.onMaximizeChange?.((v: boolean) => setIsMaximized(v))
    const un = onUpdateDownloadProgress(p => {
      const pct = p.totalBytes > 0 ? Math.round((p.receivedBytes / p.totalBytes) * 100) : Math.round(p.percent)
      setProgress(Number.isFinite(pct) ? pct : 0)
    })
    return un
  }, [])

  function togglePin() {
    const next = !isPinned
    setIsPinned(next)
    window.api?.setAlwaysOnTop(next)
  }

  useEffect(() => {
    let alive = true
    let attempt = 0
    // 延迟 6 秒再检查:不与启动时的数据库初始化/插件落位抢网络与 IO;
    // 启动早期网络栈可能未就绪 → 失败按 10s 间隔重试(最多 3 次),之后放弃静默
    const run = async () => {
      if (!alive) return
      try {
        const r = await checkForUpdate()
        if (!alive) return
        if (r.ok && r.hasUpdate && r.asset) {
          setAsset({ url: r.asset.url, name: r.asset.name, size: r.asset.size })
          setLatestVersion(r.latestVersion)
          setUpdState('available')
          return
        }
        if (r.ok) return // 已是最新
      } catch { /* fallthrough */ }
      if (alive && attempt < 3) {
        attempt++
        timerRef.current = window.setTimeout(run, 10000)
      }
    }
    timerRef.current = window.setTimeout(run, 6000)
    return () => { alive = false; if (timerRef.current !== null) window.clearTimeout(timerRef.current) }
  }, [])

  const handleUpdateClick = async () => {
    if (busyRef.current) return
    if (updState === 'downloaded' && downloadedPathRef.current) {
      busyRef.current = true
      try {
        const r = await installUpdate(downloadedPathRef.current)
        if (!r.success) showToastSafe(`运行安装程序失败:${r.message || ''}`)
      } finally { busyRef.current = false }
      return
    }
    if (updState !== 'available' || !asset) return
    setUpdState('downloading')
    setProgress(0)
    busyRef.current = true
    try {
      const r = await downloadUpdate(asset.url, asset.name, asset.size)
      if (r.success && r.filePath) {
        downloadedPathRef.current = r.filePath
        setUpdState('downloaded')
        showToastSafe(`v${latestVersion} 安装包已就绪,点击标题栏 ▶ 运行安装`)
      } else {
        setUpdState('available')
        showToastSafe(`更新包下载失败:${r.message || ''}`)
      }
    } finally {
      busyRef.current = false
    }
  }

  return (
    <div
      className="relative flex items-center justify-between h-9 bg-[var(--bg-tertiary)] border-b border-[var(--border-color)] select-none shrink-0 drag-region"
    >
      {/* drag region spacer */}
      <div className="flex-1" />

      {/* 开发版角标：dev server �?http://，打包版�?file:// */}
      {typeof location !== 'undefined' && location.protocol === 'http:' && (
        <span className="absolute left-3 top-1/2 -translate-y-1/2 px-1.5 py-0.5 text-[10px] font-semibold rounded bg-amber-500/20 text-amber-500 border border-amber-500/40 no-drag select-none">
          DEV
        </span>
      )}

      {/* VS Code 风格居中搜索�?�?absolute centering */}
      <div className="absolute left-1/2 -translate-x-1/2 no-drag" style={{ width: 'min(100% - 180px, 560px)' }}>
        <div id="titlebar-search" />
      </div>

      {/* 窗口控制按钮 */}
      <div className="flex h-full no-drag">
          {updState !== 'hidden' && (
            <WinBtn onClick={() => { void handleUpdateClick() }}
              title={
                updState === 'downloading' ? `正在下载 v${latestVersion}… ${progress}%`
                : updState === 'downloaded' ? `v${latestVersion} 已下载,点击运行安装程序`
                : `发现新版本 v${latestVersion},点击下载`
              }
            >
              {updState === 'downloading'
                ? <span className="relative flex items-center justify-center w-[18px] h-[18px]">
                    <Loader2 size={13} strokeWidth={2} className="animate-spin text-[var(--accent)]" />
                  </span>
                : updState === 'downloaded'
                  ? <Play size={12} strokeWidth={2.5} className="text-[var(--success)]" fill="currentColor" />
                  : <ArrowDownToLine size={14} strokeWidth={2} className="text-[var(--accent)]" />}
              {updState === 'available' && (
                <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-[var(--warning)] animate-pulse" title="" />
              )}
            </WinBtn>
          )}
          <WinBtn onClick={() => window.dispatchEvent(new CustomEvent('lockscreen:toggle'))} title="锁屏">
            <Lock size={14} strokeWidth={1.5} />
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
