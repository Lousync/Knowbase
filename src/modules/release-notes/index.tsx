import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Check, History, Sparkles } from 'lucide-react'
import { getReleaseNote, getReleaseNotesState, listReleaseNotes, markReleaseNotesShown } from '../../lib/ipc'
import type {
  ReleaseNote, ReleaseNoteHighlight, ReleaseNoteItem, ReleaseNoteListEntry, ReleaseNotesState,
} from '../../types'

/**
 * 更新说明（VS Code 式）—— 主界面模块页。
 *
 * 载体说明：本应用**没有全局文档 Tab 栏**（`TabBar.tsx` 存在但未接线），所以
 * 「tab 模式」在这里落地为一个普通模块页：启动时按版本判定自动切到它，
 * 平时从活动栏齿轮菜单 / 设置 → 关于与更新 进入。详见 docs/release-notes-design.md。
 *
 * 三层数据（主进程给，本页只渲染）：
 *   ① 手写亮点  highlights —— 页面上部，讲清哪几件事值得看
 *   ② 完整清单  groups     —— 页面下部，由 CHANGELOG 自动同步，保证不漏
 *   ③ 阅读记录  markShown  —— 本页成功渲染后回写仓库 `.knowbase/modules/release-notes/`
 *
 * 主题：全部走 `var(--*)`，含插件主题天然跟随（不需要欢迎页那套 postMessage 握手 ——
 * 那是 `kbview://` 沙箱 iframe 的跨进程问题，本页在渲染层进程内）。
 */

type View = { kind: 'current' } | { kind: 'all' } | { kind: 'v'; version: string }

/** 行内 Markdown：只处理反引号 code（生成数据已剥掉粗体标记，不需要完整解析器） */
function InlineText({ text }: { text: string }) {
  const parts = useMemo(() => text.split(/(`[^`]+`)/g), [text])
  return (
    <>
      {parts.map((p, i) =>
        p.length > 1 && p.startsWith('`') && p.endsWith('`') ? (
          <code key={i} className="kb-md-code">{p.slice(1, -1)}</code>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  )
}

function HighlightCard({ h, index }: { h: ReleaseNoteHighlight; index: number }) {
  return (
    <div
      className="kb-item-in rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4"
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <div className="mb-1.5 flex items-center gap-2">
        <Sparkles size={13} className="shrink-0 text-[var(--accent)]" />
        <span className="text-[13.5px] font-medium text-[var(--text-primary)]">{h.title}</span>
      </div>
      <p className="text-[12.5px] leading-[1.75] text-[var(--text-secondary)]">
        <InlineText text={h.desc} />
      </p>
      {h.detail && (
        <p className="mt-1.5 text-[11.5px] leading-[1.7] text-[var(--text-muted)]">
          <InlineText text={h.detail} />
        </p>
      )}
    </div>
  )
}

function NoteItem({ item, delay }: { item: ReleaseNoteItem; delay: number }) {
  return (
    <li className="kb-item-in" style={{ animationDelay: `${delay}ms` }}>
      <div className="text-[12.5px] leading-[1.8] text-[var(--text-secondary)]">
        {item.lead ? (
          <>
            <span className="font-medium text-[var(--text-primary)]">{item.lead}</span>
            <span className="text-[var(--text-muted)]">：</span>
          </>
        ) : null}
        <InlineText text={item.rest} />
      </div>
      {item.sub.length > 0 && (
        <ul className="mt-1 space-y-1 border-l border-[var(--border-color)] pl-3">
          {item.sub.map((s, i) => (
            <li key={i} className="text-[11.5px] leading-[1.75] text-[var(--text-muted)]">
              <InlineText text={s} />
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

export function ReleaseNotesModule({ onDismiss }: { onDismiss?: () => void }) {
  const [state, setState] = useState<ReleaseNotesState | null>(null)
  const [note, setNote] = useState<ReleaseNote | null>(null)
  const [highlights, setHighlights] = useState<ReleaseNoteHighlight[]>([])
  const [list, setList] = useState<ReleaseNoteListEntry[] | null>(null)
  const [view, setView] = useState<View>({ kind: 'current' })
  const [loadFailed, setLoadFailed] = useState(false)
  const markedRef = useRef(false)

  // 启动检测 + 全量版本列表（列表体积很小，一次拿完，供「全部版本」直接渲染）
  useEffect(() => {
    let alive = true
    Promise.all([getReleaseNotesState(), listReleaseNotes()])
      .then(([st, ls]) => {
        if (!alive) return
        setState(st)
        setList(ls ?? [])
      })
      .catch(() => { if (alive) setLoadFailed(true) })
    return () => { alive = false }
  }, [])

  // 当前视图要展示的版本
  const targetVersion = state
    ? view.kind === 'current'
      ? state.currentVersion
      : view.kind === 'v'
        ? view.version
        : ''
    : ''

  useEffect(() => {
    if (!targetVersion) return
    let alive = true
    getReleaseNote(targetVersion)
      .then((r) => {
        if (!alive) return
        setNote(r?.note ?? null)
        setHighlights(r?.highlights ?? [])
      })
      .catch(() => { if (alive) setNote(null) })
    return () => { alive = false }
  }, [targetVersion])

  // 本版说明成功渲染 → 回写基线（「首装不弹 / patch 不弹」的判定依据）。
  // 只在当前应用版本上写：翻看历史版本不该把基线拨回去（主进程侧也有同款守卫）。
  useEffect(() => {
    if (!state || !note || markedRef.current) return
    if (note.version !== state.currentVersion) return
    markedRef.current = true
    void markReleaseNotesShown(note.version)
  }, [state, note])

  const dismiss = (): void => {
    if (onDismiss) onDismiss()
  }

  const total = list?.length ?? 0
  const isCurrent = view.kind === 'current'

  return (
    // 根节点必须 h-full 而不是 flex-1：槽位容器（App.tsx renderMounted 的第 716 行）是
    // `flex-1 min-h-0` 的 **块级** div（没有 flex/flex-col），flex-1 在这里完全不生效 ——
    // 高度随内容增长、永不溢出，于是内层 overflow-y-auto 拿不到可滚高度，滚轮没反应。
    // help / user / ai-teaching / blog 四个模块的根节点同样都是 h-full。
    <div className="flex h-full flex-col overflow-hidden">
      {/* 页头：紧凑一条，不铺大标题（用户反感装饰性元素） */}
      <div className="flex shrink-0 items-center gap-3 border-b border-[var(--border-color)] px-4 py-2.5">
        {!isCurrent && (
          <button
            onClick={() => setView({ kind: 'current' })}
            className="flex items-center gap-1 text-[12px] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
            title="返回本版更新说明"
          >
            <ArrowLeft size={13} />
            返回
          </button>
        )}
        <span className="text-[12.5px] text-[var(--text-primary)]">更新说明</span>
        {state && (
          <span className="text-[12px] text-[var(--text-muted)]">
            v{view.kind === 'v' ? view.version : state.currentVersion}
          </span>
        )}
        <div className="flex-1" />
        {isCurrent && total > 0 && (
          <button
            onClick={() => setView({ kind: 'all' })}
            className="flex items-center gap-1 rounded border border-[var(--border-color)] px-2.5 py-1 text-[12px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          >
            <History size={12} />
            全部 {total} 个版本
          </button>
        )}
        {onDismiss && (
          <button
            onClick={dismiss}
            className="flex items-center gap-1 rounded border border-[var(--border-color)] px-2.5 py-1 text-[12px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          >
            <Check size={12} />
            知道了
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[760px] px-6 py-6">
          {loadFailed && (
            <p className="text-[12.5px] text-[var(--text-muted)]">更新说明读取失败（主进程未就绪或无当前仓库）。</p>
          )}

          {/* ---- 全部版本 ---- */}
          {view.kind === 'all' && (
            <div className="kb-view-in">
              <p className="mb-4 text-[12px] text-[var(--text-muted)]">
                共 {total} 个版本。内容来自仓库根 <span className="kb-md-code">CHANGELOG.md</span>，与文档站同源。
              </p>
              {/* 不加 .kb-cv：该类是给「长列表的列表项」用的（估值 120px/项），
                  而本列表固定 37 行、每行约 40px —— 估值会把滚动高度抬到实际的三倍，
                  滚动条位置会跳。37 行也不构成渲染压力。 */}
              <ul className="space-y-1">
                {list?.map((v, i) => (
                  <li key={v.version} className="kb-item-in" style={{ animationDelay: `${Math.min(i, 20) * 18}ms` }}>
                    <button
                      onClick={() => setView({ kind: 'v', version: v.version })}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-[var(--bg-hover)]"
                    >
                      <span className="w-[68px] shrink-0 text-[12.5px] font-medium text-[var(--text-primary)]">
                        v{v.version}
                      </span>
                      <span className="w-[86px] shrink-0 text-[11.5px] text-[var(--text-muted)]">
                        {v.date || '—'}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--text-secondary)]">
                        {v.summary || '（无摘要）'}
                      </span>
                      <span className="shrink-0 text-[11.5px] text-[var(--text-muted)]">{v.itemCount} 条</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* ---- 单版本详情 ---- */}
          {view.kind !== 'all' && note && (
            <div className="kb-view-in">
              <div className="mb-6">
                <h2 className="text-[19px] font-medium text-[var(--text-primary)]">v{note.version}</h2>
                <p className="mt-0.5 text-[12px] text-[var(--text-muted)]">
                  {note.date || '（CHANGELOG 未记日期）'}
                </p>
              </div>

              {note.summary && (
                <div className="mb-6 rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4">
                  <p className="text-[12.5px] leading-[1.8] text-[var(--text-secondary)]">
                    <InlineText text={note.summary} />
                  </p>
                </div>
              )}

              {highlights.length > 0 && (
                <section className="mb-8">
                  <h3 className="mb-3 text-[13px] font-medium text-[var(--text-primary)]">这一版值得看</h3>
                  <div className="space-y-3">
                    {highlights.map((h, i) => (
                      <HighlightCard key={h.title} h={h} index={i} />
                    ))}
                  </div>
                </section>
              )}

              {note.groups.length > 0 && (
                <section>
                  <h3 className="mb-3 text-[13px] font-medium text-[var(--text-primary)]">全部变更</h3>
                  <div className="space-y-6">
                    {note.groups.map((g, gi) => (
                      <div key={`${g.title}-${gi}`}>
                        <div className="mb-2 flex items-center gap-2">
                          <span className="text-[12.5px] font-medium text-[var(--text-primary)]">{g.title}</span>
                          <span className="h-[1px] flex-1 bg-[var(--border-color)]" />
                          <span className="text-[11.5px] text-[var(--text-muted)]">{g.items.length}</span>
                        </div>
                        <ul className="space-y-2.5">
                          {g.items.map((it, ii) => (
                            <NoteItem
                              key={ii}
                              item={it}
                              delay={Math.min(gi * 40 + ii * 22, 400)}
                            />
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <p className="mt-8 border-t border-[var(--border-color)] pt-4 text-[11.5px] leading-[1.8] text-[var(--text-muted)]">
                本页内容随应用版本发布，离线可读；阅读记录写在当前仓库的
                <span className="kb-md-code">.knowbase/modules/release-notes/</span>
                下，换电脑拷走仓库即一并带走。
              </p>
            </div>
          )}

          {/* ---- 该版本无数据 ---- */}
          {view.kind !== 'all' && !note && !loadFailed && (
            <p className="text-[12.5px] text-[var(--text-muted)]">
              {targetVersion ? `这一版（v${targetVersion}）还没有更新说明。` : '正在读取…'}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
