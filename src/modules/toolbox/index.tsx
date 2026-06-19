import { useState } from 'react'
import { Key, Braces, Code, Calculator, Clock, Timer } from 'lucide-react'
import { PasswordGenerator } from './components/PasswordGenerator'
import { PomodoroTimer } from './components/PomodoroTimer'

// ---- Tool registry ----
interface ToolDefinition {
  id: string
  name: string
  desc: string
  icon: React.ReactNode
  available: boolean
}

const DATA_TOOLS: ToolDefinition[] = [
  {
    id: 'password-generator',
    name: '强密码生成器',
    desc: '按字符类型和长度生成高强度随机密码',
    icon: <Key size={17} strokeWidth={1.5} />,
    available: true,
  },
  {
    id: 'json-formatter',
    name: 'JSON 格式化',
    desc: 'JSON 美化 / 压缩 / 校验',
    icon: <Braces size={17} strokeWidth={1.5} />,
    available: false,
  },
  {
    id: 'base64-codec',
    name: 'Base64 编解码',
    desc: '文本与 Base64 互转',
    icon: <Code size={17} strokeWidth={1.5} />,
    available: false,
  },
  {
    id: 'timestamp',
    name: '时间戳转换',
    desc: 'Unix 时间戳与日期互转',
    icon: <Clock size={17} strokeWidth={1.5} />,
    available: false,
  },
  {
    id: 'unit-converter',
    name: '单位换算',
    desc: '长度 / 重量 / 温度 / 数据大小换算',
    icon: <Calculator size={17} strokeWidth={1.5} />,
    available: false,
  },
]

const PRODUCTIVITY_TOOLS: ToolDefinition[] = [
  {
    id: 'pomodoro',
    name: '番茄钟',
    desc: '25 分钟专注 + 5 分钟休息循环',
    icon: <Timer size={17} strokeWidth={1.5} />,
    available: true,
  },
]

export function ToolboxModule() {
  const [activeTool, setActiveTool] = useState<string | null>(null)

  const renderTool = () => {
    switch (activeTool) {
      case 'password-generator':
        return <PasswordGenerator onBack={() => setActiveTool(null)} />
      case 'pomodoro':
        return <PomodoroTimer onBack={() => setActiveTool(null)} />
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
    <div className="grid grid-cols-3 gap-2.5 w-full max-w-[600px]">
      {tools.map(tool => (
        <button
          key={tool.id}
          disabled={!tool.available}
          onClick={() => tool.available && setActiveTool(tool.id)}
          className={`
            flex flex-col items-center gap-1.5 p-3 rounded-md border transition-all text-center
            ${tool.available
              ? 'border-[var(--border-color)] bg-[var(--bg-secondary)] hover:border-[var(--accent)] hover:bg-[var(--bg-tertiary)] cursor-pointer group'
              : 'border-[var(--border-color)] bg-[var(--bg-tertiary)] opacity-40 cursor-not-allowed'
            }
          `}
        >
          <div className={`${tool.available ? 'text-[var(--accent)] group-hover:text-[var(--accent-hover)]' : 'text-[var(--text-disabled)]'}`}>
            {tool.icon}
          </div>
          <div className={`text-[12px] font-medium leading-tight ${tool.available ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}`}>
            {tool.name}
            {!tool.available && <span className="ml-1 text-[10px] text-[var(--text-disabled)]">即将推出</span>}
          </div>
          <div className="text-[10px] text-[var(--text-muted)] leading-snug">{tool.desc}</div>
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
        <p className="text-[12px] text-[var(--text-muted)] mt-0.5">内嵌实用小工具，点击卡片进入</p>
      </div>

      {/* Tool sections */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {renderSection('数据工具', DATA_TOOLS)}

        {/* Divider */}
        <div className="flex items-center gap-3 max-w-[600px] mx-auto">
          <div className="flex-1 h-px bg-[var(--border-color)]" />
        </div>

        {renderSection('效率工具', PRODUCTIVITY_TOOLS)}
      </div>
    </div>
  )
}
