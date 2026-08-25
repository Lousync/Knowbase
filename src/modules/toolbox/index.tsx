import { useState, useEffect, useCallback } from 'react'
import { Shield, TrendingDown, Timer, CalendarCheck2, Globe, BellRing, Puzzle } from 'lucide-react'
import { PasswordVault } from './components/PasswordVault'
import { WeightTracker } from './components/WeightTracker'
import { HabitTracker } from './components/habit-tracker'
import { BookmarkNav } from './components/bookmark-nav'
import { RemoteSupervise } from './components/remote-supervise'
import { getPluginTools, type PluginTool } from '../../lib/pluginService'
import { PluginIconImg } from '../../components/shared/PluginIconImg'
import { showToast } from '../../lib/toast'

// ---- Tool registry ----
interface ToolDefinition {
  id: string
  name: string
  icon: React.ReactNode
  available: boolean
}

const DATA_TOOLS: ToolDefinition[] = [
  {
    id: 'weight-tracker',
    name: '体重追踪',
    icon: <TrendingDown size={26} strokeWidth={1.5} />,
    available: true,
  },
  {
    id: 'password-vault',
    name: '密码本',
    icon: <Shield size={26} strokeWidth={1.5} />,
    available: true,
  },
  {
    id: 'bookmark-nav',
    name: '网址导航',
    icon: <Globe size={26} strokeWidth={1.5} />,
    available: true,
  },
]

const PRODUCTIVITY_TOOLS: ToolDefinition[] = [
  {
    id: 'pomodoro',
    name: '番茄钟',
    icon: <Timer size={26} strokeWidth={1.5} />,
    available: true,
  },
  {
    id: 'habit-tracker',
    name: '习惯打卡',
    icon: <CalendarCheck2 size={26} strokeWidth={1.5} />,
    available: true,
  },
  {
    id: 'remote-supervise',
    name: '远程监督',
    icon: <BellRing size={26} strokeWidth={1.5} />,
    available: true,
  },
]

export function ToolboxModule() {
  const [activeTool, setActiveTool] = useState<string | null>(null)
  const [pluginTools, setPluginTools] = useState<PluginTool[]>([])
  const [activePluginTool, setActivePluginTool] = useState<PluginTool | null>(null)

  const refreshPluginTools = useCallback(async () => {
    try { setPluginTools(await getPluginTools()) } catch { /* 忽略 */ }
  }, [])

  useEffect(() => { refreshPluginTools() }, [refreshPluginTools])

  // 插件模块安装/启禁/卸载后同步刷新;切换标签页时也兜底刷新一次
  useEffect(() => {
    const refresh = () => refreshPluginTools()
    window.addEventListener('plugins-changed', refresh)
    window.addEventListener('tab-switched', refresh)
    return () => {
      window.removeEventListener('plugins-changed', refresh)
      window.removeEventListener('tab-switched', refresh)
    }
  }, [refreshPluginTools])

  const handleActivateTool = (toolId: string) => {
    if (toolId === 'pomodoro') {
      window.dispatchEvent(new CustomEvent('pomodoro:activate', { detail: { preset: 0 } }))
      return
    }
    setActiveTool(toolId)
  }

  const renderTool = () => {
    switch (activeTool) {
      case 'weight-tracker':
        return <WeightTracker onBack={() => setActiveTool(null)} />
      case 'password-vault':
        return <PasswordVault onBack={() => setActiveTool(null)} />
      case 'habit-tracker':
        return <HabitTracker onBack={() => setActiveTool(null)} />
      case 'remote-supervise':
        return <RemoteSupervise onBack={() => setActiveTool(null)} />
      case 'bookmark-nav':
        return <BookmarkNav onBack={() => setActiveTool(null)} />
      default:
        return null
    }
  }

  // 内置工具全屏
  if (activeTool) {
    return (
      <div className="flex flex-col h-full bg-[var(--bg-primary)]">
        {renderTool()}
      </div>
    )
  }

  // UI 插件工具全屏宿主
  if (activePluginTool) {
    return (
      <PluginToolHost
        tool={activePluginTool}
        onBack={() => { setActivePluginTool(null); refreshPluginTools() }}
      />
    )
  }

  const renderCardGrid = (tools: ToolDefinition[]) => (
    <div className="grid grid-cols-3 gap-3 w-full max-w-[660px]">
      {tools.map(tool => (
        <button
          key={tool.id}
          disabled={!tool.available}
          onClick={() => tool.available && handleActivateTool(tool.id)}
          className={`
            flex flex-col items-center gap-2.5 p-5 rounded-lg border transition-all text-center
            ${tool.available
              ? 'border-[var(--border-color)] bg-[var(--bg-secondary)] hover:border-[var(--accent)] hover:bg-[var(--bg-tertiary)] cursor-pointer group'
              : 'border-[var(--border-color)] bg-[var(--bg-tertiary)] opacity-40 cursor-not-allowed'
            }
          `}
        >
          <div className={`${tool.available ? 'text-[var(--accent)] group-hover:text-[var(--accent-hover)]' : 'text-[var(--text-disabled)]'}`}>
            {tool.icon}
          </div>
          <div className={`text-[13px] font-medium leading-tight ${tool.available ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}`}>
            {tool.name}
            {!tool.available && <span className="ml-1 text-[10px] text-[var(--text-disabled)]">即将推出</span>}
          </div>
        </button>
      ))}
    </div>
  )

  const renderSection = (title: string, tools: ToolDefinition[]) => (
    <div className="space-y-2.5">
      <h3 className="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider px-1">{title}</h3>
      <div className="flex justify-center">
        {renderCardGrid(tools)}
      </div>
    </div>
  )

  // Gallery view
  return (
    <div className="flex flex-col h-full bg-[var(--bg-primary)]">
      {/* Header */}
      <div className="px-5 py-4 border-b border-[var(--border-color)] shrink-0">
        <h2 className="text-[16px] font-medium text-[var(--text-primary)]">🧰 工具箱</h2>
      </div>

      {/* Tool sections */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {renderSection('数据工具', DATA_TOOLS)}

        {/* Divider */}
        <div className="flex items-center gap-3 max-w-[600px] mx-auto">
          <div className="flex-1 h-px bg-[var(--border-color)]" />
        </div>

        {renderSection('效率工具', PRODUCTIVITY_TOOLS)}

        {/* 插件工具(UI 插件贡献) */}
        {pluginTools.length > 0 && (
          <>
            <div className="flex items-center gap-3 max-w-[600px] mx-auto">
              <div className="flex-1 h-px bg-[var(--border-color)]" />
            </div>

            <div className="space-y-2.5">
              <h3 className="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider px-1">插件工具</h3>
              <div className="flex justify-center">
                <div className="grid grid-cols-3 gap-3 w-full max-w-[660px]">
                  {pluginTools.map(t => (
                    <button
                      key={`${t.pluginId}:${t.toolId}`}
                      onClick={() => setActivePluginTool(t)}
                      className="flex flex-col items-center gap-2.5 p-5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] hover:border-[var(--accent)] hover:bg-[var(--bg-tertiary)] transition-all text-center group cursor-pointer"
                    >
                      <div className="text-[var(--accent)] group-hover:text-[var(--accent-hover)]">
                        <PluginIconImg src={t.icon} size={26} className="group-hover:opacity-90" />
                      </div>
                      <div className="text-[13px] font-medium leading-tight text-[var(--text-primary)]">{t.name}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/** UI 插件宿主:sandbox iframe 加载 plugin:// 页面,postMessage 桥提供剪贴板等最小能力 */
function PluginToolHost({ tool, onBack }: { tool: PluginTool; onBack: () => void }) {
  const src = `plugin://${tool.pluginId}/${tool.entry}`

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const d = e.data
      if (!d || d.channel !== 'kb-plugin') return
      if (d.action === 'copy' && typeof d.payload === 'string') {
        navigator.clipboard.writeText(d.payload)
          .then(() => showToast({ type: 'info', message: '已复制到剪贴板' }))
          .catch(() => showToast({ type: 'error', message: '复制失败' }))
      } else if (d.action === 'toast' && typeof d.payload === 'string') {
        showToast({ type: 'info', message: d.payload })
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  // iframe 加载完成后下发主题变量(插件据此适配深浅色)
  const sendInit = () => {
    const iframe = document.querySelector<HTMLIFrameElement>('iframe[data-plugin-frame]')
    if (!iframe?.contentWindow) return
    const style = getComputedStyle(document.documentElement)
    const varNames = ['--bg-primary', '--bg-secondary', '--bg-tertiary', '--bg-hover', '--text-primary', '--text-secondary', '--text-muted', '--text-disabled', '--accent', '--accent-hover', '--border-color', '--success', '--danger', '--warning']
    const vars: Record<string, string> = {}
    for (const name of varNames) vars[name] = style.getPropertyValue(name).trim()
    iframe.contentWindow.postMessage({ channel: 'kb-plugin', action: 'init', payload: { vars } }, '*')
  }

  return (
    <div className="flex flex-col h-full bg-[var(--bg-primary)]">
      <div className="px-5 py-3 border-b border-[var(--border-color)] shrink-0 flex items-center gap-3">
        <button onClick={onBack} className="text-[13px] text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors">
          ← 返回
        </button>
        <h2 className="text-[15px] font-medium text-[var(--text-primary)] flex items-center gap-2">
          <Puzzle size={15} className="text-[var(--accent)]" />
          {tool.name}
          <span className="text-[10px] text-[var(--text-disabled)] font-normal">插件</span>
        </h2>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <iframe
          data-plugin-frame
          src={src}
          onLoad={sendInit}
          sandbox="allow-scripts"
          className="w-full h-full border-0"
          title={tool.name}
        />
      </div>
    </div>
  )
}
