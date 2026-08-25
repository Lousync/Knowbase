import { useState, useEffect, useCallback } from 'react'
import { Key, Shield, TrendingDown, Timer, CalendarCheck2, Globe, BellRing, Puzzle, Store } from 'lucide-react'
import { PasswordGenerator } from './components/PasswordGenerator'
import { PasswordVault } from './components/PasswordVault'
import { WeightTracker } from './components/WeightTracker'
import { HabitTracker } from './components/habit-tracker'
import { BookmarkNav } from './components/bookmark-nav'
import { RemoteSupervise } from './components/remote-supervise'
import { PluginMarketModal } from './components/plugins/PluginMarketModal'
import { PluginDetailModal } from './components/plugins/PluginDetailModal'
import { pluginListInstalled } from '../../lib/ipc'
import type { PluginSummary } from '../../types'

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
    id: 'password-generator',
    name: '强密码生成器',
    icon: <Key size={26} strokeWidth={1.5} />,
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
  const [plugins, setPlugins] = useState<PluginSummary[]>([])
  const [marketOpen, setMarketOpen] = useState(false)
  const [detailPlugin, setDetailPlugin] = useState<PluginSummary | null>(null)

  const refreshPlugins = useCallback(async () => {
    try { setPlugins(await pluginListInstalled()) } catch { /* 忽略 */ }
  }, [])

  useEffect(() => { refreshPlugins() }, [refreshPlugins])

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
      case 'password-generator':
        return <PasswordGenerator onBack={() => setActiveTool(null)} />
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

  // If a tool is active, show it full-screen
  if (activeTool) {
    return (
      <div className="flex flex-col h-full bg-[var(--bg-primary)]">
        {renderTool()}
      </div>
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
      <div className="px-5 py-4 border-b border-[var(--border-color)] shrink-0 flex items-center">
        <h2 className="text-[16px] font-medium text-[var(--text-primary)] flex-1">🧰 工具箱</h2>
        <button
          onClick={() => setMarketOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-[var(--text-secondary)] border border-[var(--border-color)] rounded-md hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
        >
          <Store size={13} />
          插件市场
        </button>
      </div>

      {/* Tool sections */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {renderSection('数据工具', DATA_TOOLS)}

        {/* Divider */}
        <div className="flex items-center gap-3 max-w-[600px] mx-auto">
          <div className="flex-1 h-px bg-[var(--border-color)]" />
        </div>

        {renderSection('效率工具', PRODUCTIVITY_TOOLS)}

        {/* 插件区(有已安装插件时显示) */}
        {plugins.length > 0 && (
          <>
            <div className="flex items-center gap-3 max-w-[600px] mx-auto">
              <div className="flex-1 h-px bg-[var(--border-color)]" />
            </div>

            <div className="space-y-2.5">
              <h3 className="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider px-1">插件</h3>
              <div className="flex justify-center">
                <div className="grid grid-cols-3 gap-3 w-full max-w-[660px]">
                  {plugins.map(p => (
                    <button
                      key={p.id}
                      onClick={() => setDetailPlugin(p)}
                      className={`flex flex-col items-center gap-2.5 p-5 rounded-lg border transition-all text-center group ${
                        p.broken || !p.enabled
                          ? 'border-[var(--border-color)] bg-[var(--bg-tertiary)] opacity-50'
                          : 'border-[var(--border-color)] bg-[var(--bg-secondary)] hover:border-[var(--accent)] hover:bg-[var(--bg-tertiary)]'
                      }`}
                    >
                      <div className={p.broken || !p.enabled ? 'text-[var(--text-disabled)]' : 'text-[var(--accent)] group-hover:text-[var(--accent-hover)]'}>
                        <Puzzle size={26} strokeWidth={1.5} />
                      </div>
                      <div className={`text-[13px] font-medium leading-tight ${p.enabled && !p.broken ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}`}>
                        {p.name}
                      </div>
                      <div className="text-[10px] text-[var(--text-disabled)] font-mono">
                        {p.broken ? '已损坏' : p.enabled ? `v${p.version}` : '已禁用'}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {marketOpen && (
        <PluginMarketModal
          installedIds={Object.fromEntries(plugins.map(p => [p.id, p.version]))}
          onClose={() => setMarketOpen(false)}
          onInstalled={refreshPlugins}
        />
      )}
      {detailPlugin && (
        <PluginDetailModal
          plugin={detailPlugin}
          onClose={() => setDetailPlugin(null)}
          onChanged={refreshPlugins}
        />
      )}
    </div>
  )
}
