export function ShortcutsView() {
  return (
    <div>
      <h2 className="text-[16px] font-semibold text-[var(--text-primary)] mb-1">快捷键</h2>
      <p className="text-[12px] text-[var(--text-muted)] mb-6">所有可用的键盘快捷键一览</p>

      <div className="space-y-8">
        <Group label="全局">
          <Row keys={['Ctrl', 'B']} desc="展开 / 折叠侧栏" />
          <Row keys={['Escape']} desc="关闭弹窗 / 从编辑器返回列表" />
        </Group>

        <Group label="知识库 — 编辑器">
          <Row keys={['Ctrl', 'S']} desc="立即保存当前页面" />
          <Row keys={['Ctrl', '/']} desc="切换 Markdown 预览（仅 md / txt 文件）" />
          <Row keys={['Escape']} desc="关闭弹窗后返回页面列表" />
        </Group>

        <Group label="知识库 — 侧栏">
          <Row keys={['F2']} desc="重命名选中的目录 / 笔记本 / 章节" />
          <Row keys={['Delete']} desc="删除选中的目录 / 笔记本 / 章节" />
        </Group>

        <Group label="知识库 — Tab 管理">
          <Row keys={['Ctrl', 'N']} desc="新建零散页面" />
          <Row keys={['Ctrl', 'W']} desc="关闭当前打开的 Tab 页" />
          <Row keys={['Ctrl', 'Tab']} desc="切换到下一个 Tab" />
          <Row keys={['Ctrl', 'Shift', 'Tab']} desc="切换到上一个 Tab" />
        </Group>

        <Group label="博客">
          <Row keys={['Ctrl', 'N']} desc="新建 / 打开今日文章" />
          <Row keys={['Ctrl', 'S']} desc="保存并关闭编辑器" />
          <Row keys={['Ctrl', '/']} desc="切换 Markdown 预览" />
          <Row keys={['Escape']} desc="从编辑器 / 详情返回列表" />
          <Row keys={['Delete']} desc="删除当前查看的文章" />
        </Group>

        <Group label="日程">
          <Row keys={['Ctrl', 'N']} desc="打开新建任务弹窗" />
          <Row keys={['Escape']} desc="关闭弹窗（编辑 / 四象限 / 标签管理）" />
        </Group>
      </div>
    </div>
  )
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-2">
        {label}
      </h3>
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}

function Row({ keys, desc }: { keys: string[]; desc: string }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-[13px] text-[var(--text-primary)]">{desc}</span>
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
