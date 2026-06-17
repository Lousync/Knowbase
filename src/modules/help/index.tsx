import { useState } from 'react'
import { BookOpen, Keyboard, Tag, Smile, AlertTriangle, Calendar, FileText, Search } from 'lucide-react'

interface DocEntry {
  id: string
  category: string
  title: string
  icon: React.ReactNode
  content: React.ReactNode
}

const DOCS: DocEntry[] = [
  {
    id: 'shortcuts',
    category: '操作指南',
    title: '键盘快捷键',
    icon: <Keyboard size={14} />,
    content: (
      <div className="space-y-5">
        <Group label="全局">
          <Row keys={['Ctrl', 'B']}>折叠 / 展开侧栏</Row>
          <Row keys={['Escape']}>关闭弹窗 / 返回列表</Row>
        </Group>
        <Group label="知识库">
          <Row keys={['Ctrl', 'N']}>新建零散页面</Row>
          <Row keys={['Ctrl', 'W']}>关闭当前 Tab</Row>
          <Row keys={['Ctrl', 'Tab']}>下一个 Tab</Row>
          <Row keys={['Ctrl', 'Shift', 'Tab']}>上一个 Tab</Row>
          <Row keys={['F2']}>重命名选中项</Row>
          <Row keys={['Delete']}>删除选中项</Row>
          <Row keys={['Ctrl', 'S']}>立即保存</Row>
          <Row keys={['Ctrl', '/']}>切换预览</Row>
        </Group>
        <Group label="博客">
          <Row keys={['Ctrl', 'N']}>新建 / 打开今日文章</Row>
          <Row keys={['Ctrl', 'S']}>保存并关闭</Row>
          <Row keys={['Ctrl', '/']}>切换预览</Row>
          <Row keys={['Escape']}>返回列表</Row>
          <Row keys={['Delete']}>删除文章</Row>
        </Group>
        <Group label="日程">
          <Row keys={['Ctrl', 'N']}>新建任务</Row>
          <Row keys={['Escape']}>关闭弹窗</Row>
        </Group>
      </div>
    ),
  },
  {
    id: 'tags',
    category: '操作指南',
    title: '博客标签',
    icon: <Tag size={14} />,
    content: (
      <div className="space-y-3">
        <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed">
          标签用于对博客文章进行分类。每篇文章最多可添加 <strong className="text-[var(--text-primary)]">5 个标签</strong>。
        </p>
        <h4 className="text-[12px] font-semibold text-[var(--text-primary)]">使用方法</h4>
        <ol className="list-decimal ml-4 space-y-1.5 text-[13px] text-[var(--text-secondary)]">
          <li>打开任意一篇博客进入编辑器</li>
          <li>在工具栏下方的标签栏点击 <span className="text-[var(--accent)]">+ 标签</span></li>
          <li>输入标签名称，按 Enter 确认</li>
          <li>标签会自动保存，显示在博客卡片上</li>
        </ol>
        <h4 className="text-[12px] font-semibold text-[var(--text-primary)] mt-3">删除标签</h4>
        <p className="text-[13px] text-[var(--text-secondary)]">
          点击标签右侧的 ✕ 按钮即可移除。标签仅从当前文章中移除，不会删除标签本身。
        </p>
      </div>
    ),
  },
  {
    id: 'moods',
    category: '操作指南',
    title: '心情状态',
    icon: <Smile size={14} />,
    content: (
      <div className="space-y-3">
        <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed">
          使用 Emoji 表情记录每天的心情状态。支持多选，也可不选。
        </p>
        <div className="flex items-center gap-3 bg-[var(--bg-tertiary)] rounded-lg p-3">
          <span className="text-2xl">😄</span>
          <span className="text-2xl">😫</span>
          <span className="text-2xl">😢</span>
          <span className="text-2xl">😕</span>
        </div>
        <table className="w-full text-[12px] text-[var(--text-secondary)]">
          <tbody>
            <tr className="border-b border-[var(--border-color)]"><td className="py-1.5 pr-4 text-[var(--text-primary)] font-medium">😄 开心</td><td>积极愉快的情绪</td></tr>
            <tr className="border-b border-[var(--border-color)]"><td className="py-1.5 pr-4 text-[var(--text-primary)] font-medium">😫 疲倦</td><td>精力耗尽、需要休息</td></tr>
            <tr className="border-b border-[var(--border-color)]"><td className="py-1.5 pr-4 text-[var(--text-primary)] font-medium">😢 难过</td><td>悲伤或失落的情绪</td></tr>
            <tr><td className="py-1.5 pr-4 text-[var(--text-primary)] font-medium">😕 困惑</td><td>对某事感到迷茫或不确定</td></tr>
          </tbody>
        </table>
      </div>
    ),
  },
  {
    id: 'blog-writing',
    category: '操作指南',
    title: '博客写作',
    icon: <FileText size={14} />,
    content: (
      <div className="space-y-3">
        <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed">
          每天可以写一篇博客文章，使用 <strong className="text-[var(--text-primary)]">Markdown</strong> 格式编写。
        </p>
        <h4 className="text-[12px] font-semibold text-[var(--text-primary)]">创建</h4>
        <ul className="list-disc ml-4 space-y-1 text-[13px] text-[var(--text-secondary)]">
          <li>点击侧栏 <span className="text-[var(--accent)]">今日文章编写</span> 创建今天的文章</li>
          <li>在侧栏归档树中点击任意日期创建 / 打开对应日期的文章</li>
          <li>使用搜索框输入日期快速定位</li>
        </ul>
        <h4 className="text-[12px] font-semibold text-[var(--text-primary)] mt-3">日期限制</h4>
        <ul className="list-disc ml-4 space-y-1 text-[13px] text-[var(--text-secondary)]">
          <li>不能创建未来日期的文章</li>
          <li>支持历史日期补写（有最早日期限制）</li>
          <li>已有的未来日期文章可正常编辑和删除</li>
        </ul>
      </div>
    ),
  },
  {
    id: 'calendar',
    category: '参考信息',
    title: '日期搜索',
    icon: <Calendar size={14} />,
    content: (
      <div className="space-y-3">
        <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed">
          侧栏搜索框支持多种日期格式：
        </p>
        <table className="w-full text-[12px] text-[var(--text-secondary)]">
          <tbody>
            <tr className="border-b border-[var(--border-color)]">
              <td className="py-1.5 pr-4"><code className="text-[var(--accent)] bg-[var(--bg-tertiary)] px-1 rounded">2026</code></td>
              <td>搜索该年所有文章</td>
            </tr>
            <tr className="border-b border-[var(--border-color)]">
              <td className="py-1.5 pr-4"><code className="text-[var(--accent)] bg-[var(--bg-tertiary)] px-1 rounded">2026/06</code></td>
              <td>搜索该月所有文章</td>
            </tr>
            <tr>
              <td className="py-1.5 pr-4"><code className="text-[var(--accent)] bg-[var(--bg-tertiary)] px-1 rounded">2026/06/17</code></td>
              <td>搜索指定日期</td>
            </tr>
            <tr className="border-b border-[var(--border-color)]">
              <td className="py-1.5 pr-4"><code className="text-[var(--accent)] bg-[var(--bg-tertiary)] px-1 rounded">06/17</code></td>
              <td>搜索月-日匹配（跨年）</td>
            </tr>
            <tr>
              <td className="py-1.5 pr-4"><code className="text-[var(--accent)] bg-[var(--bg-tertiary)] px-1 rounded">17</code></td>
              <td>模糊搜索含该数字的日期</td>
            </tr>
          </tbody>
        </table>
      </div>
    ),
  },
  {
    id: 'troubleshoot',
    category: '参考信息',
    title: '常见问题',
    icon: <AlertTriangle size={14} />,
    content: (
      <div className="space-y-4">
        <div>
          <h4 className="text-[12px] font-semibold text-[var(--text-primary)]">为什么内容没有保存？</h4>
          <p className="text-[12px] text-[var(--text-secondary)] mt-1">
            博客编辑器支持自动保存（每 2 秒）。可随时按 <kbd className="px-1 bg-[var(--bg-tertiary)] rounded text-[11px]">Ctrl+S</kbd> 手动保存。
          </p>
        </div>
        <div>
          <h4 className="text-[12px] font-semibold text-[var(--text-primary)]">误删了文章怎么办？</h4>
          <p className="text-[12px] text-[var(--text-secondary)] mt-1">
            删除的文章会进入 <strong>回收站</strong>，在回收站可以恢复。回收站中的内容 30 天后自动清空。
          </p>
        </div>
        <div>
          <h4 className="text-[12px] font-semibold text-[var(--text-primary)]">笔记间的链接怎么用？</h4>
          <p className="text-[12px] text-[var(--text-secondary)] mt-1">
            知识库支持 Wiki 风格的双向链接。在编辑器中输入 <code className="text-[var(--accent)] bg-[var(--bg-tertiary)] px-1 rounded">[[页面标题]]</code> 即可创建链接。
          </p>
        </div>
      </div>
    ),
  },
]

/** Group docs by category, preserving order */
function groupByCategory(docs: DocEntry[]): Map<string, DocEntry[]> {
  const map = new Map<string, DocEntry[]>()
  for (const d of docs) {
    if (!map.has(d.category)) map.set(d.category, [])
    map.get(d.category)!.push(d)
  }
  return map
}

// Module-level target for cross-component navigation (toast "查看详情" etc.)
let pendingDocId: string | null = null

export function navigateToHelp(docId: string) {
  pendingDocId = docId
  window.dispatchEvent(new CustomEvent('help:open'))
}

export function HelpModule() {
  const categories = groupByCategory(DOCS)
  const [activeDoc, setActiveDoc] = useState(() => {
    const id = pendingDocId
    pendingDocId = null
    return id || 'shortcuts'
  })

  const activeEntry = DOCS.find(d => d.id === activeDoc)

  return (
    <div className="flex h-full bg-[var(--bg-primary)]">
      {/* Left nav */}
      <div className="w-48 shrink-0 bg-[var(--bg-secondary)] border-r border-[var(--border-color)] py-4 flex flex-col">
        <div className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wide px-4 mb-2">
          帮助
        </div>

        {[...categories.entries()].map(([cat, docs]) => (
          <div key={cat} className="mb-3">
            <div className="text-[10px] font-semibold text-[var(--text-disabled)] uppercase tracking-wide px-4 mb-1">
              {cat}
            </div>
            {docs.map(d => (
              <button
                key={d.id}
                onClick={() => setActiveDoc(d.id)}
                className={`w-full flex items-center gap-2 px-4 py-1.5 text-[13px] transition-colors ${
                  activeDoc === d.id
                    ? 'bg-[var(--bg-selected)] text-[var(--text-primary)] border-l-2 border-l-[var(--accent)] pl-[14px]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] border-l-2 border-l-transparent pl-[14px]'
                }`}
              >
                <span className={activeDoc === d.id ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}>
                  {d.icon}
                </span>
                {d.title}
              </button>
            ))}
          </div>
        ))}
      </div>

      {/* Right content */}
      <div className="flex-1 overflow-y-auto py-8">
        <div className="max-w-2xl mx-auto px-8">
          {activeEntry && (
            <>
              <h2 className="text-[16px] font-semibold text-[var(--text-primary)] mb-1">
                {activeEntry.title}
              </h2>
              <p className="text-[12px] text-[var(--text-muted)] mb-8">{activeEntry.category}</p>
              {activeEntry.content}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ---- Keyboard shortcut table helpers ----

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-2">
        {label}
      </h4>
      <div className="space-y-1">{children}</div>
    </div>
  )
}

function Row({ keys, children }: { keys: string[]; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-[13px] text-[var(--text-primary)]">{children}</span>
      <div className="flex items-center gap-1 shrink-0">
        {keys.map((k, i) => (
          <span key={i} className="inline-flex items-center px-1.5 py-0.5 text-[11px] font-mono bg-[var(--input-bg)] border border-[var(--border-color)] rounded text-[var(--text-secondary)] min-w-[20px] justify-center">
            {k}
          </span>
        ))}
      </div>
    </div>
  )
}
