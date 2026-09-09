import { useEffect, useRef, useState } from 'react'
import { X, FileText, Image as ImageIcon, Presentation, ExternalLink } from 'lucide-react'
import { MarkdownPreview } from '../../components/shared/MarkdownPreview'
import { ArtHtmlView } from './ArtHtmlView'
import type { ArtTab } from './artifacts'

/**
 * 工件栏（docs/ai-teaching-artifacts-pane-design.md §2）：页签条 + 工具条 + 内容区。
 * 对话固定左主区永不替换，材料/产物/示意图全部进这里以页签切换；
 * 开合纯内容驱动：有页签即渲染、关完即消失（2026-09-09 拍板，不设手动收起/展开把手——与素材库拉出条打架）；
 * 页签列表为会话内存态（切会话清空），阅读位置记忆 per-rel 保存在本组件（跨会话不失效）。
 */
export function ArtifactsPane({ tabs, activeId, widthPx, htmlSeq, onActivate, onClose, onReload, onPptxPage, onTalkPage, pending, onEdit }: {
  tabs: ArtTab[]
  activeId: string | null
  widthPx: number
  htmlSeq: Record<string, number>
  onActivate: (id: string) => void
  onClose: (id: string) => void
  onReload: (tab: ArtTab) => void
  onPptxPage: (id: string, delta: number) => void
  onTalkPage: (tab: ArtTab) => void
  pending: boolean
  onEdit: (rel: string) => void
}) {
  const tab = tabs.find(t => t.id === activeId) ?? null
  const mdScrollRef = useRef<HTMLDivElement>(null)
  const mdScrollPos = useRef<Record<string, number>>({})
  const [outline, setOutline] = useState<Array<{ id: string; text: string; lv: number }>>([])

  // md 页签渲染完成：收集 h2/h3 大纲 + 恢复滚动位置（§2 阅读位置记忆，沿原 docView §3.9-2 口径）
  useEffect(() => {
    if (tab?.kind !== 'md') { setOutline([]); return }
    const raf = requestAnimationFrame(() => {
      const els = mdScrollRef.current?.querySelectorAll('h2, h3') ?? []
      setOutline(Array.from(els).map(el => ({ id: (el as HTMLElement).id, text: (el.textContent ?? '').trim(), lv: el.tagName === 'H2' ? 2 : 3 })).filter(x => x.id && x.text))
      if (mdScrollRef.current) mdScrollRef.current.scrollTop = mdScrollPos.current[tab.rel] ?? 0
    })
    return () => cancelAnimationFrame(raf)
  }, [tab?.kind, tab?.id, tab?.rel, tab?.content])

  const iconOf = (t: ArtTab) => t.kind === 'md'
    ? <FileText size={11} className="shrink-0 text-[var(--accent)]" />
    : t.kind === 'pptx'
      ? <Presentation size={11} className="shrink-0 text-[var(--accent)]" />
      : <ImageIcon size={11} className="shrink-0 text-[var(--accent)]" />

  return (
    <div className="h-full flex flex-col min-h-0 bg-[var(--bg-secondary)] border-l border-[var(--border-color)]">
      {/* 页签条：icon+名称+✕；溢出横向滚动；生成中页签禁关（§2） */}
      <div className="shrink-0 flex items-center gap-0.5 px-2 pt-1.5 pb-0 overflow-x-auto [scrollbar-width:none] select-none">
        {tabs.map(t => (
          <div key={t.id} onClick={() => onActivate(t.id)}
            onMouseDown={e => { if (e.button === 1 && !t.generating) { e.preventDefault(); onClose(t.id) } }}
            title={`${t.generating ? '生成中…' : t.name}${t.rel ? `\n${t.rel}` : ''}`}
            className={`group shrink-0 flex items-center gap-1 px-2 py-1 rounded-t-lg border border-b-0 text-[11.5px] cursor-pointer whitespace-nowrap max-w-[170px] transition-colors ${
              t.id === activeId ? 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)] font-medium' : 'border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}`}>
            {iconOf(t)}
            <span className="truncate">{t.generating ? '生成中…' : t.name}</span>
            {!t.generating && (
              <button onClick={e => { e.stopPropagation(); onClose(t.id) }} title="关闭页签"
                className="shrink-0 opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity"><X size={10} /></button>
            )}
          </div>
        ))}
        <div className="flex-1 min-w-[8px]" />
      </div>
      {/* 工具条：落盘路径 + ↗编辑 + ⟳ + ✕关闭（§2） */}
      {tab && (
        <div className="shrink-0 flex items-center gap-2 px-2.5 py-1 bg-[var(--bg-primary)] border-b border-[var(--border-color)] text-[10.5px] select-none min-w-0">
          <span className="flex-1 min-w-0 truncate text-[var(--text-muted)]" title={tab.rel || ''}>
            {tab.generating ? `visuals/${tab.slug ?? ''}.html（生成中）` : `${tab.rel}${tab.lines ? ` · ${tab.lines} 行` : ''}`}
          </span>
          {!tab.generating && tab.rel && (
            <button onClick={() => onEdit(tab.rel)} title="在编辑器中打开（可编辑保存后 ⟳ 刷新）"
              className="shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors">
              <ExternalLink size={10} /> 编辑
            </button>
          )}
          {!tab.generating && tab.rel && (
            <button onClick={() => onReload(tab)} title="重读磁盘文件刷新"
              className="shrink-0 px-1.5 py-0.5 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors">⟳</button>
          )}
          {!tab.generating && (
            <button onClick={() => onClose(tab.id)} title="关闭页签"
              className="shrink-0 px-1.5 py-0.5 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors">✕</button>
          )}
        </div>
      )}
      {/* 内容区（切换 fadein 280ms，§5.6） */}
      <div className="flex-1 min-h-0 flex" key={tab?.id ?? 'empty'}>
        {!tab ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-[12px] text-[var(--text-muted)] px-6 text-center">
            <div className="text-[24px]">🗂</div>
            <div>没有打开的工件</div>
            <div className="text-[11px]">点对话里的工件卡、素材库条目的「原件/提取稿」，或让 AI「画个示意图」</div>
          </div>
        ) : tab.generating ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-[12px] text-[var(--text-muted)]">
            <div className="w-[26px] h-[26px] rounded-full border-[3px] border-[var(--border-color)] border-t-[var(--accent)] animate-spin" />
            <div>visual.html 正在生成示意图…</div>
            <div className="text-[10.5px]">产出将写入会话 visuals/ 目录 · 单文件自包含</div>
          </div>
        ) : tab.kind === 'md' ? (
          <>
            <div ref={mdScrollRef} onScroll={e => { mdScrollPos.current[tab.rel] = (e.target as HTMLDivElement).scrollTop }}
              className="kb-art-in flex-1 overflow-y-auto min-h-0">
              <div className="max-w-[820px] mx-auto py-5 px-5">
                <MarkdownPreview content={tab.content ?? ''} />
              </div>
            </div>
            {outline.length > 2 && widthPx >= 640 && (
              <div className="w-[140px] shrink-0 border-l border-[var(--border-color)] overflow-y-auto py-2" title="文档大纲（h2/h3，点击定位）">
                <div className="px-2.5 pb-1 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">大纲</div>
                {outline.map((h, i) => (
                  <button key={`${h.id}-${i}`} onClick={() => { const el = mdScrollRef.current?.querySelector(`[id="${CSS.escape(h.id)}"]`); el?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}
                    className={`block w-full text-left px-2.5 py-0.5 text-[10.5px] truncate text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors ${h.lv === 3 ? 'pl-5' : ''}`}
                    title={h.text}>{h.text}</button>
                ))}
              </div>
            )}
          </>
        ) : tab.kind === 'html' ? (
          <div className="kb-art-in flex-1 min-h-0"><ArtHtmlView relPath={tab.rel} reloadSeq={htmlSeq[tab.rel] ?? 0} /></div>
        ) : (
          /* pptx 逐页阅读并入页签（§1.4：页码即内容） */
          <div className="kb-art-in flex-1 min-h-0 flex flex-col">
            <div className="flex-1 overflow-y-auto min-h-0">
              <div className="max-w-[720px] mx-auto py-3 px-4">
                <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-4 py-3 min-h-[200px]">
                  <div className="inline-flex items-center gap-1 text-[10.5px] px-1.5 py-0.5 rounded bg-[var(--bg-hover)] text-[var(--text-muted)] mb-2.5">
                    第 {(tab.cur ?? 0) + 1} / {tab.pages?.length ?? 0} 页 · 原文编号 {tab.pages?.[tab.cur ?? 0]?.n}
                  </div>
                  {tab.pages?.[tab.cur ?? 0]?.text?.trim() ? (
                    <pre className="whitespace-pre-wrap break-words font-[var(--font-sans)] text-[12.5px] leading-relaxed">{tab.pages[tab.cur ?? 0].text}</pre>
                  ) : (
                    <div className="text-[12px] text-[var(--text-muted)]">（本页无文字内容——多为图表演示页）</div>
                  )}
                </div>
                <div className="flex justify-between mt-2">
                  <button onClick={() => onPptxPage(tab.id, -1)} disabled={(tab.cur ?? 0) <= 0}
                    className="px-1.5 py-0.5 rounded-md text-[11.5px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-30 transition-colors">← 上一页</button>
                  <button onClick={() => onTalkPage(tab)} disabled={pending}
                    className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[11.5px] bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] disabled:opacity-40 transition-colors">讲解此页</button>
                  <button onClick={() => onPptxPage(tab.id, 1)} disabled={(tab.cur ?? 0) >= (tab.pages?.length ?? 0) - 1}
                    className="px-1.5 py-0.5 rounded-md text-[11.5px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-30 transition-colors">下一页 →</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
