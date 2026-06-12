import { useState } from 'react'
import { Download, FileJson, FileText, Database, Check, Settings, History, FileArchive } from 'lucide-react'

interface ModuleOption {
  id: string
  label: string
  icon: React.ReactNode
  count?: string
}

const MODULES: ModuleOption[] = [
  { id: 'blog', label: '博客', icon: <FileText size={16} />, count: '文章 + 标签' },
  { id: 'schedule', label: '日程', icon: <Database size={16} />, count: '待办 + 四象限' },
  { id: 'knowledge', label: '知识库', icon: <FileArchive size={16} />, count: '页面 + 分类 + 链接' },
]

const FORMATS = [
  { id: 'json', label: 'JSON 单文件', desc: '完整保留关联数据，可重新导入', icon: <FileJson size={14} /> },
  { id: 'markdown', label: 'Markdown + ZIP', desc: '每篇文章/页面一个 .md 文件打包', icon: <FileText size={14} /> },
  { id: 'sqlite', label: 'SQLite 原始文件', desc: '直接复制 knowledge.db', icon: <Database size={14} /> },
]

interface HistoryItem {
  date: string
  label: string
  format: string
}

const MOCK_HISTORY: HistoryItem[] = [
  { date: '2026-06-10', label: '完整备份', format: 'JSON' },
  { date: '2026-06-05', label: '博客导出', format: 'ZIP' },
  { date: '2026-06-01', label: '知识库导出', format: 'Markdown' },
]

export function ExportModule() {
  const [selectedModules, setSelectedModules] = useState<Set<string>>(new Set(['blog', 'schedule', 'knowledge']))
  const [format, setFormat] = useState('json')

  const allChecked = selectedModules.size === MODULES.length

  const toggleAll = () => {
    if (allChecked) setSelectedModules(new Set())
    else setSelectedModules(new Set(MODULES.map(m => m.id)))
  }

  const toggleModule = (id: string) => {
    const next = new Set(selectedModules)
    if (next.has(id)) next.delete(id); else next.add(id)
    setSelectedModules(next)
  }

  return (
    <div className="flex h-full bg-[#1e1e1e]">
      {/* Left: Config panel */}
      <div className="w-56 shrink-0 bg-[#252526] border-r border-[#3c3c3c] flex flex-col overflow-y-auto">
        {/* Header */}
        <div className="px-4 py-3 border-b border-[#3c3c3c]">
          <div className="flex items-center gap-2 text-[12px] text-[#969696]">
            <Settings size={14} />
            <span className="font-semibold uppercase tracking-wide">导出配置</span>
          </div>
        </div>

        {/* Module checkboxes */}
        <div className="px-3 py-3 border-b border-[#3c3c3c]">
          <label className="flex items-center gap-2 py-1 text-[12px] text-[#969696] cursor-pointer hover:text-[#cccccc]">
            <input type="checkbox" checked={allChecked} onChange={toggleAll} className="accent-[#007acc]" />
            全选
          </label>
          <div className="my-1 border-t border-[#2d2d2d]" />
          {MODULES.map(m => (
            <label key={m.id} className="flex items-center gap-2 py-1.5 text-[12px] text-[#969696] cursor-pointer hover:text-[#cccccc]">
              <input type="checkbox" checked={selectedModules.has(m.id)} onChange={() => toggleModule(m.id)} className="accent-[#007acc]" />
              <span className="text-[#969696]">{m.icon}</span>
              <div className="flex flex-col">
                <span className="text-[#cccccc] text-[13px]">{m.label}</span>
                <span className="text-[10px] text-[#6a6a6a]">{m.count}</span>
              </div>
            </label>
          ))}
        </div>

        {/* Format radio */}
        <div className="px-3 py-3">
          <div className="text-[11px] font-semibold text-[#6a6a6a] uppercase tracking-wide mb-2">导出格式</div>
          {FORMATS.map(f => (
            <label
              key={f.id}
              onClick={() => setFormat(f.id)}
              className={`flex items-start gap-2 py-2 px-2 rounded cursor-pointer transition-colors ${
                format === f.id ? 'bg-[#094771]' : 'hover:bg-[#2a2d2e]'
              }`}
            >
              <div className={`mt-0.5 w-4 h-4 shrink-0 rounded-full border-2 flex items-center justify-center ${
                format === f.id ? 'border-[#007acc]' : 'border-[#6a6a6a]'
              }`}>
                {format === f.id && <div className="w-2 h-2 rounded-full bg-[#007acc]" />}
              </div>
              <div>
                <div className="text-[12px] text-[#cccccc] flex items-center gap-1.5">
                  <span className="text-[#6a6a6a]">{f.icon}</span>
                  {f.label}
                </div>
                <div className="text-[10px] text-[#6a6a6a] mt-0.5">{f.desc}</div>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Right: Preview + History */}
      <div className="flex-1 flex flex-col">
        <div className="flex-1 flex flex-col items-center justify-center gap-6 px-8">
          {/* Summary card */}
          <div className="bg-[#252526] border border-[#3c3c3c] rounded-lg p-6 w-full max-w-sm">
            <div className="text-[11px] font-semibold text-[#6a6a6a] uppercase tracking-wide mb-3">导出预览</div>
            <div className="space-y-2 text-[13px]">
              <div className="flex justify-between">
                <span className="text-[#969696]">选中模块</span>
                <span className="text-[#cccccc]">{selectedModules.size} / {MODULES.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#969696]">导出格式</span>
                <span className="text-[#cccccc]">{FORMATS.find(f => f.id === format)?.label}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#969696]">预计大小</span>
                <span className="text-[#cccccc]">~ 2.3 MB</span>
              </div>
            </div>
          </div>

          {/* Export button */}
          <button
            disabled={selectedModules.size === 0}
            onClick={() => { /* TODO */ }}
            className="flex items-center gap-2 px-8 py-3 bg-[#007acc] text-white text-[14px] font-medium rounded-lg hover:bg-[#1a8ad4] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download size={18} />
            执行导出
          </button>
        </div>

        {/* History footer */}
        <div className="border-t border-[#3c3c3c] bg-[#252526] px-6 py-3">
          <div className="flex items-center gap-2 text-[11px] font-semibold text-[#6a6a6a] uppercase tracking-wide mb-2">
            <History size={13} />
            导出历史
          </div>
          <div className="space-y-0.5">
            {MOCK_HISTORY.map((h, i) => (
              <div key={i} className="flex items-center justify-between text-[12px] py-1">
                <div className="flex items-center gap-2">
                  <Check size={12} className="text-[#4ec9b0]" />
                  <span className="text-[#cccccc]">{h.label}</span>
                </div>
                <div className="flex items-center gap-3 text-[#6a6a6a]">
                  <span>{h.format}</span>
                  <span>{h.date}</span>
                </div>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-[#555] mt-2">当前为 UI 原型 · 历史记录为模拟数据</p>
        </div>
      </div>
    </div>
  )
}
