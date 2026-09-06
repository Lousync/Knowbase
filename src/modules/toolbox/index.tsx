import { useState, useEffect, useCallback, useRef } from 'react'
import { Shield, TrendingDown, Timer, CalendarCheck2, Globe, BellRing, Puzzle, Archive, GraduationCap, FileText, Wifi, Wrench, ArrowLeft, Scissors } from 'lucide-react'
import { PasswordVault } from './components/PasswordVault'
import { WeightTracker } from './components/WeightTracker'
import { HabitTracker } from './components/habit-tracker'
import { WordbookModule } from './components/wordbook'
import { PdfToolkit } from './components/pdf-toolkit'
import { BookmarkNav } from './components/bookmark-nav'
import { RemoteSupervise } from './components/remote-supervise'
import { ExportTool } from './components/export/ExportTool'
import { LanShare } from './components/lan-share'
import { WebClipper } from './components/web-clipper'
import { getPluginTools, type PluginTool } from '../../lib/pluginService'
import { showToast } from '../../lib/toast'
import { PluginIconImg } from '../../components/shared/PluginIconImg'
import { PluginFrame } from '../../components/shared/PluginFrame'

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
    icon: <TrendingDown size={20} strokeWidth={1.5} />,
    available: true,
  },
  {
    id: 'password-vault',
    name: '密码本',
    icon: <Shield size={20} strokeWidth={1.5} />,
    available: true,
  },
  {
    id: 'bookmark-nav',
    name: '网址导航',
    icon: <Globe size={20} strokeWidth={1.5} />,
    available: true,
  },
  {
    id: 'data-export',
    name: '数据导出',
    icon: <Archive size={20} strokeWidth={1.5} />,
    available: true,
  },
  {
    id: 'lan-share',
    name: '设备传输',
    icon: <Wifi size={20} strokeWidth={1.5} />,
    available: true,
  },
  {
    id: 'web-clipper',
    name: '网页剪藏',
    icon: <Scissors size={20} strokeWidth={1.5} />,
    available: true,
  },
]

const PRODUCTIVITY_TOOLS: ToolDefinition[] = [
  {
    id: 'pomodoro',
    name: '番茄钟',
    icon: <Timer size={20} strokeWidth={1.5} />,
    available: true,
  },
  {
    id: 'habit-tracker',
    name: '习惯打卡',
    icon: <CalendarCheck2 size={20} strokeWidth={1.5} />,
    available: true,
  },
  {
    id: 'remote-supervise',
    name: '远程监督',
    icon: <BellRing size={20} strokeWidth={1.5} />,
    available: true,
  },
  {
    id: 'wordbook',
    name: '单词本',
    icon: <GraduationCap size={20} strokeWidth={1.5} />,
    available: true,
  },
  {
    id: 'pdf-toolkit',
    name: 'PDF 工具箱',
    icon: <FileText size={20} strokeWidth={1.5} />,
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
      case 'wordbook':
        return <WordbookModule onBack={() => setActiveTool(null)} />
      case 'pdf-toolkit':
        return <PdfToolkit onBack={() => setActiveTool(null)} />
      case 'bookmark-nav':
        return <BookmarkNav onBack={() => setActiveTool(null)} />
      case 'data-export':
        return <ExportTool onBack={() => setActiveTool(null)} />
      case 'lan-share':
        return <LanShare onBack={() => setActiveTool(null)} />
      case 'web-clipper':
        return <WebClipper onBack={() => setActiveTool(null)} />
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
            flex flex-col items-center gap-2 p-4 rounded-lg border transition-all text-center
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
      <div className="flex items-center gap-1 border-b border-[var(--border-color)] px-2 py-1 text-[11.5px] text-[var(--text-muted)] shrink-0 select-none">
        <Wrench size={12} />
        工具箱
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
                      className="flex flex-col items-center gap-2 p-4 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] hover:border-[var(--accent)] hover:bg-[var(--bg-tertiary)] transition-all text-center group cursor-pointer"
                    >
                      <div className="text-[var(--accent)] group-hover:text-[var(--accent-hover)] relative">
                        <PluginIconImg src={t.icon} size={20} className="group-hover:opacity-90" />
                        <span
                          className="absolute -top-0.5 -right-1 w-2 h-2 rounded-full border border-[var(--bg-secondary)]"
                          style={{ background: t.riskLevel === 'B' ? 'var(--danger)' : t.riskLevel === 'A' ? 'var(--warning)' : 'var(--success)' }}
                          title={`安全等级 ${t.riskLevel}`}
                        />
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

/** UI 插件宿主:sandbox iframe 加载 plugin:// 页面,postMessage 桥按授权白名单执行 */
function PluginToolHost({ tool, onBack }: { tool: PluginTool; onBack: () => void }) {
  // V3-2 授权单点化：改用 PluginFrame v2 双轨宿主（v2 报文 → host:rpc 主进程 Gateway 裁决，
  // data.*/kb.store.*/files.* 全可用；v1 报文保留兼容分支服务存量插件）。
  // 替代原 v1 手工 iframe + 白名单桥（data 通道此前「未开放」）。
  return (
    <div className="flex flex-col h-full bg-[var(--bg-primary)]">
      <div className="flex items-center gap-2 border-b border-[var(--border-color)] px-2 py-1 shrink-0">
        <button
          onClick={onBack}
          className="p-1 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
          title="返回"
        >
          <ArrowLeft size={12} />
        </button>
        <span className="text-[11.5px] font-medium text-[var(--text-muted)] flex items-center gap-1.5">
          <Puzzle size={12} className="text-[var(--accent)]" />
          {tool.name}
        </span>
        <span className="ml-auto text-[11px] text-[var(--text-disabled)]">插件</span>
      </div>
      <div className="min-h-0 flex-1">
        <PluginFrame
          key={`${tool.pluginId}:${tool.entry}`}
          pluginId={tool.pluginId}
          entry={tool.entry}
          grantedCapabilities={tool.grantedCapabilities}
          onDenied={(reason) => showToast({ type: 'warning', message: `插件请求被拒绝:${reason}` })}
        />
      </div>
    </div>
  )
}
