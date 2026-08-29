import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Star, Zap, Trash2, RotateCcw, Plus, Sparkles, Check, Flame, Volume2, Eye, Settings2, ChevronDown, X, ArrowUpDown } from 'lucide-react'
import { useSettings } from '../../../../lib/SettingsContext'
import { showToast } from '../../../../lib/toast'
import { speak } from '../../../../lib/tts'
import {
  wordbookGetToday, wordbookAnswer, wordbookSetBook, wordbookList, wordbookRemove,
  wordbookSetMastered, wordbookAdd, wordbookCheck, wordbookMarkKnown, wordbookStats,
  wordbookBookWords, translateInvoke, dictLookup, wordbookRelations,
  wordbookRootClusters, wordbookSynonymClusters,
  wordbookGroupsList, wordbookGroupsCreate, wordbookGroupsDelete,
  wordbookGroupsAddWord, wordbookGroupsRemoveWord, wordbookGroupsWords, wordbookCustomQueue,
} from '../../../../lib/ipc'
import type {
  WordbookTodayDto, WordbookEntryDto, WordbookBook, WordFeedback, TranslateInvokeResult,
  WordbookStatsDto, QuestionType, BookWordRowDto, WordbookCustomQueueDto,
  RootClusterDto, SynonymClusterDto, WordbookGroupDto, WordRelationRowDto, DictLookupResult,
} from '../../../../types'
import { MarkdownPreview } from '../../../../components/shared/MarkdownPreview'

/**
 * 单词本（工具箱）：每日队列学习（四选一/听音/拼写/例句填空轮换）、
 * 三档反馈驱动简化 SM-2、生词本管理、词书浏览与批量标记、打卡联动。
 * 键盘流：1-4 选题 / f=不会看答案 / 翻面后 1=认识 2=模糊 3=不认识 / Enter=下一个。
 */

const BOOKS: { id: WordbookBook; label: string }[] = [
  { id: 'cet4', label: 'CET-4' },
  { id: 'cet6', label: 'CET-6' },
  { id: 'ky', label: '考研' },
]

const TAG_LABELS: Record<string, string> = { cet4: '四级', cet6: '六级', ky: '考研', toefl: '托福', ielts: '雅思', gre: 'GRE', gk: '高考', zk: '中考' }
const TYPE_LABELS: Record<QuestionType, string> = { choice: '辨义', listen: '听音', spell: '拼写', cloze: '例句' }

type ExchangeKey = 'past' | 'pp' | 'ing' | 's3' | 'plural' | 'er' | 'est'
const EXCHANGE_ROWS: [ExchangeKey, string][] = [
  ['past', '过去式'], ['pp', '过去分词'], ['ing', '现在分词'],
  ['s3', '三单'], ['plural', '复数'], ['er', '比较级'], ['est', '最高级'],
]

export function WordbookModule({ onBack }: { onBack: () => void }) {
  const { s, update } = useSettings()
  const [view, setView] = useState<'home' | 'study' | 'list' | 'book' | 'system'>('home')
  const [today, setToday] = useState<WordbookTodayDto | null>(null)
  const [loading, setLoading] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  /** 自定义强化复习队列（词根/近义/分组入口发起），非空时 TodayView 用它替代每日队列 */
  const [customQueue, setCustomQueue] = useState<WordbookCustomQueueDto | null>(null)
  /** 点词详情弹卡 + 列表版本号（弹卡内收藏/斩词/删除后刷新各列表） */
  const [detailWord, setDetailWord] = useState<string | null>(null)
  const [listVersion, setListVersion] = useState(0)

  const reloadToday = useCallback(async () => {
    setLoading(true)
    try { setToday(await wordbookGetToday()) } catch { setToday(null) } finally { setLoading(false) }
  }, [])
  useEffect(() => { void reloadToday() }, [reloadToday])

  const startCustomRound = useCallback(async (label: string, words: string[]) => {
    const q = await wordbookCustomQueue(label, words)
    if (q.items.length === 0) { showToast({ type: 'info', message: '这组词没有可学习的内容' }); return }
    setCustomQueue(q)
    setView('study')
  }, [])

  const exitCustomRound = useCallback(() => { setCustomQueue(null); void reloadToday() }, [reloadToday])

  const openWord = useCallback((w: string) => setDetailWord(w), [])
  const onDetailChanged = useCallback(() => { setListVersion(v => v + 1); void reloadToday() }, [reloadToday])

  const setBook = async (book: WordbookBook | '') => {
    await wordbookSetBook(book)
    await update('wordbookActiveBook', book)
    void reloadToday()
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* 顶栏 */}
      <div className="shrink-0 px-4 py-2.5 border-b border-[var(--border-color)] flex items-center gap-3 flex-wrap">
        {/* 分区页先回总览；总览页才退回工具箱 */}
        <button onClick={() => (view === 'home' ? onBack() : setView('home'))}
          title={view === 'home' ? '返回工具箱' : '返回总览'}
          className="p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
        </button>
        <span className="text-[13px] font-semibold text-[var(--text-primary)]">单词本</span>
        <div className="flex items-center gap-1">
          {BOOKS.map(b => (
            <button key={b.id} onClick={() => void setBook(s.wordbookActiveBook === b.id ? '' : b.id)}
              className={`px-2 py-0.5 rounded text-[11px] transition-colors ${s.wordbookActiveBook === b.id
                ? 'bg-[var(--accent)] text-white'
                : 'border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>
              {b.label}
            </button>
          ))}
        </div>
        {today && today.book && (
          <div className="flex items-center gap-2 min-w-36">
            <div className="flex-1 h-1.5 rounded-full bg-[var(--bg-hover)] overflow-hidden min-w-20">
              <div className="h-full bg-[var(--accent)] rounded-full transition-all"
                style={{ width: `${today.bookTotal ? Math.min(100, (today.bookLearned / today.bookTotal) * 100) : 0}%` }} />
            </div>
            <span className="text-[11px] text-[var(--text-muted)] tabular-nums">{today.bookLearned}/{today.bookTotal}</span>
          </div>
        )}
        {today && (
          <span className="flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
            <Flame size={11} className="text-orange-400" /> 连续 {today.streakDays} 天
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {/* 学习设置（弹层，不占顶栏） */}
          <div className="relative">
            <button onClick={() => setSettingsOpen(o => !o)} title="学习设置"
              className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors">
              <Settings2 size={13} />
            </button>
            {settingsOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setSettingsOpen(false)} />
                <div className="absolute right-0 top-8 z-20 w-64 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] shadow-xl p-3 space-y-2.5">
                  <div>
                    <p className="text-[11px] font-medium text-[var(--text-primary)] mb-1">每日新词数</p>
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => void update('wordbookNewPerDay', Math.max(0, s.wordbookNewPerDay - 5))}
                        className="px-2 py-0.5 rounded border border-[var(--border-color)] text-[11px] hover:bg-[var(--bg-hover)]">−5</button>
                      <input type="number" min={0} max={200} value={s.wordbookNewPerDay}
                        onChange={e => { const n = Math.max(0, Math.min(200, Math.floor(Number(e.target.value) || 0))); void update('wordbookNewPerDay', n) }}
                        className="w-16 px-1.5 py-0.5 rounded border border-[var(--border-color)] bg-[var(--input-bg)] text-[12px] text-center text-[var(--text-primary)] outline-none" />
                      <button onClick={() => void update('wordbookNewPerDay', Math.min(200, s.wordbookNewPerDay + 5))}
                        className="px-2 py-0.5 rounded border border-[var(--border-color)] text-[11px] hover:bg-[var(--bg-hover)]">+5</button>
                    </div>
                    <p className="text-[10px] text-[var(--text-muted)] mt-1 leading-relaxed">复习量不设上限；新词量越大，之后的复习负担越重。</p>
                  </div>
                  <div className="pt-2 border-t border-[var(--border-color)]">
                    <p className="text-[10px] text-[var(--text-muted)] leading-relaxed">
                      提示：在「习惯打卡」中新建习惯并联动来源「背单词」，完成每日目标可自动打卡。
                    </p>
                  </div>
                </div>
              </>
            )}
          </div>
          <button onClick={() => setView(view === 'system' ? 'home' : 'system')}
            className={`px-2.5 py-1 rounded-md text-[11px] transition-colors ${view === 'system'
              ? 'bg-[var(--bg-selected)] text-[var(--text-primary)]'
              : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}`}>
            体系
          </button>
          <button onClick={() => setView(view === 'book' ? 'home' : 'book')} disabled={!s.wordbookActiveBook}
            className={`px-2.5 py-1 rounded-md text-[11px] transition-colors disabled:opacity-40 ${view === 'book'
              ? 'bg-[var(--bg-selected)] text-[var(--text-primary)]'
              : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}`} title={s.wordbookActiveBook ? '浏览词书词表' : '先选择一本词书'}>
            词书
          </button>
          <button onClick={() => setView(view === 'list' ? 'home' : 'list')}
            className={`px-2.5 py-1 rounded-md text-[11px] transition-colors ${view === 'list'
              ? 'bg-[var(--bg-selected)] text-[var(--text-primary)]'
              : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}`}>
            生词本
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto relative">
        {/* 注意：学习进行中刷新队列时 TodayView 必须保持挂载（进度/轮次状态在其中），
            故 loading 只做遮罩，不替换组件 */}
        {view === 'home' ? (
          <HomeView today={today} loading={loading} book={s.wordbookActiveBook}
            onStartStudy={() => setView('study')}
            onGoList={() => setView('list')} onGoSystem={() => setView('system')}
            onGoBook={() => setView('book')} />
        ) : view === 'study' ? (
          <TodayView today={today} loading={loading} onReload={reloadToday} override={customQueue} onExitOverride={exitCustomRound} />
        ) : view === 'list' ? (
          <ListView onReload={reloadToday} onWordClick={openWord} version={listVersion} />
        ) : view === 'book' ? (
          <BookView onWordClick={openWord} version={listVersion} />
        ) : (
          <SystemView onStartCustom={startCustomRound} onWordClick={openWord} version={listVersion} />
        )}
        {loading && today && (
          <div className="absolute inset-0 flex items-center justify-center bg-[var(--bg-primary)]/40">
            <Loader2 size={18} className="animate-spin text-[var(--text-muted)]" />
          </div>
        )}
        {detailWord && (
          <WordDetailModal word={detailWord} onClose={() => setDetailWord(null)} onChanged={onDetailChanged} />
        )}
      </div>
    </div>
  )
}

// ===== 点词详情弹卡：所有列表里的单词点击即弹出 =====

function WordDetailModal({ word, onClose, onChanged }: { word: string; onClose: () => void; onChanged?: () => void }) {
  const [dict, setDict] = useState<DictLookupResult | null>(null)
  const [rel, setRel] = useState<{ roots: RootClusterDto[]; synonyms: WordRelationRowDto[] } | null>(null)
  const [inBook, setInBook] = useState(false)
  const [mastered, setMastered] = useState(false)
  const [aiMd, setAiMd] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)

  useEffect(() => {
    wordbookCheck(word).then(r => { setInBook(r.inBook); setMastered(r.status === 'mastered') }).catch(() => { /* ignore */ })
    dictLookup(word).then(setDict).catch(() => setDict({ found: false }))
    wordbookRelations(word).then(setRel).catch(() => { /* ignore */ })
    // 预取 AI 精讲（有缓存则秒回）
    translateInvoke({ text: word, mode: 'word', ai: true })
      .then(r => { if (r.ok) setAiMd(r.markdown) })
      .catch(() => { /* ignore */ })
  }, [word])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const entry = dict?.found ? dict.entry : undefined
  const examTags = entry?.tags.filter(t => t === 'cet4' || t === 'cet6' || t === 'ky') ?? []

  const collect = async () => {
    const r = await wordbookAdd(word)
    if (r.ok) { setInBook(true); showToast({ type: 'info', message: r.already ? '已在生词本' : `已加入生词本：${word}` }); onChanged?.() }
  }
  const toggleMastered = async () => {
    const next = !mastered
    await wordbookSetMastered(word, next)
    setMastered(next); onChanged?.()
  }
  const remove = async () => {
    await wordbookRemove(word)
    setInBook(false); setMastered(false); showToast({ type: 'info', message: `已从生词本删除：${word}` }); onChanged?.()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="w-[440px] max-w-[92vw] max-h-[76vh] overflow-y-auto rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] shadow-2xl p-4"
        data-word-detail>
        {/* 头部 */}
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-[20px] font-semibold text-[var(--text-primary)] break-all">{entry?.word ?? word}</span>
              <button onClick={() => speak(entry?.word ?? word)} title="发音"
                className="text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors self-center"><Volume2 size={14} /></button>
              {entry?.phonetic && <span className="text-[12px] text-[var(--text-muted)]">/{entry.phonetic.replace(/^\/|\/$/g, '')}/</span>}
              {entry?.inflectedFrom && <span className="text-[10px] text-[var(--text-disabled)]">「{entry.inflectedFrom}」的词形还原</span>}
            </div>
            {examTags.length > 0 && (
              <div className="flex items-center gap-1 mt-1">
                {examTags.map(t => (
                  <span key={t} className="px-1.5 py-0.5 rounded text-[10px] bg-[var(--accent)]/15 text-[var(--accent)]">{TAG_LABELS[t]}</span>
                ))}
                {entry!.collins > 0 && <span className="px-1.5 py-0.5 rounded text-[10px] bg-[var(--bg-hover)] text-amber-500">{'★'.repeat(entry!.collins)}</span>}
              </div>
            )}
          </div>
          <button onClick={onClose} title="关闭 (Esc)"
            className="shrink-0 p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"><X size={14} /></button>
        </div>

        {/* 释义 */}
        {entry && entry.translationLines.length > 0 && (
          <ul className="mt-2.5 space-y-0.5">
            {entry.translationLines.slice(0, 8).map((l, i) => (
              <li key={i} className="text-[12.5px] leading-relaxed text-[var(--text-primary)] break-words">{l}</li>
            ))}
          </ul>
        )}
        {dict !== null && !dict.found && <p className="mt-2 text-[12px] text-[var(--text-muted)]">离线词典未收录该词。</p>}
        {entry?.definition && <p className="mt-1.5 text-[11px] text-[var(--text-muted)] break-words">{entry.definition}</p>}

        {/* 词形变化 */}
        {entry && EXCHANGE_ROWS.some(([k]) => entry.exchange[k]) && (
          <div className="flex items-center gap-1 flex-wrap mt-2.5">
            {EXCHANGE_ROWS.filter(([k]) => entry.exchange[k]).map(([k, label]) => (
              <span key={k} className="px-1.5 py-0.5 rounded text-[10px] border border-[var(--border-color)] text-[var(--text-secondary)]">
                {label} <span className="text-[var(--text-primary)]">{entry.exchange[k]}</span>
              </span>
            ))}
          </div>
        )}

        {/* 同根词 / 近义词 */}
        {rel && rel.roots.map(rc => (
          <div key={rc.root} className="mt-2.5">
            <p className="text-[10px] text-[var(--text-muted)]">
              词根 <span className="text-violet-300 font-medium">{rc.root}</span>
              {rc.meaning && ` · ${rc.meaning}`}{rc.origin && ` · ${rc.origin}`}
            </p>
            <div className="flex items-center gap-1 flex-wrap mt-1">
              {rc.words.slice(0, 10).map(w => (
                <span key={w.word} title={w.translationLine}
                  className={`px-1.5 py-0.5 rounded text-[10px] ${w.status !== 'none' ? 'bg-[var(--accent)]/15 text-[var(--accent)]' : 'text-[var(--text-muted)]'}`}>
                  {w.word}
                </span>
              ))}
            </div>
          </div>
        ))}
        {rel && rel.synonyms.length > 0 && (
          <div className="mt-2.5">
            <p className="text-[10px] text-[var(--text-muted)]">近义词</p>
            <div className="flex items-center gap-1 flex-wrap mt-1">
              {rel.synonyms.map(w => (
                <span key={w.word} title={w.translationLine}
                  className={`px-1.5 py-0.5 rounded text-[10px] ${w.status !== 'none' ? 'bg-[var(--accent)]/15 text-[var(--accent)]' : 'text-[var(--text-muted)]'}`}>
                  {w.word}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* AI 精讲 */}
        <div className="mt-3 pt-2.5 border-t border-[var(--border-color)]">
          <button onClick={() => setAiOpen(o => !o)}
            className="flex items-center gap-1 text-[11px] text-[var(--accent)] hover:opacity-80">
            <Sparkles size={11} /> AI 精讲{aiLoading ? '（生成中…）' : ''}
          </button>
          {aiOpen && (
            <div className="mt-1.5 text-[12px]">
              {aiLoading ? <Loader2 size={13} className="animate-spin text-[var(--text-muted)]" /> : aiMd ? <MarkdownPreview content={aiMd} /> : <span className="text-[var(--text-muted)]">暂无内容</span>}
            </div>
          )}
        </div>

        {/* 操作行 */}
        <div className="mt-3 pt-2.5 border-t border-[var(--border-color)] flex items-center gap-2">
          {!inBook && (
            <button onClick={() => void collect()}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] bg-[var(--accent)] text-white hover:opacity-90 transition-opacity">
              <Star size={11} /> 加入生词本
            </button>
          )}
          {inBook && (
            <>
              <span className="flex items-center gap-1 text-[11px] text-amber-400"><Star size={11} className="fill-current" /> 在生词本</span>
              <button onClick={() => void toggleMastered()}
                className={`px-2 py-1 rounded-md text-[11px] transition-colors ${mastered
                  ? 'bg-amber-500/15 text-amber-400 hover:bg-amber-500/25'
                  : 'border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-amber-400 hover:border-amber-400/50'}`}>
                {mastered ? '已斩 · 恢复' : '斩词（已掌握）'}
              </button>
              <button onClick={() => void remove()}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-[var(--text-muted)] hover:text-red-400 transition-colors">
                <Trash2 size={11} /> 删除
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ===== 总览（落地页：概览 + 入口，点「开始学习」才进背词界面） =====

function HomeView({ today, loading, book, onStartStudy, onGoList, onGoSystem, onGoBook }: {
  today: WordbookTodayDto | null
  loading: boolean
  book: string
  onStartStudy: () => void
  onGoList: () => void
  onGoSystem: () => void
  onGoBook: () => void
}) {
  if (loading && !today) return <Center text="加载中…" />
  if (!today) return <Center text="加载失败，请稍后重试" />
  const dueCount = today.reviewTotal
  const newCount = today.newTotal
  const bookLabel = BOOKS.find(b => b.id === book)?.label

  return (
    <div className="min-h-full flex flex-col justify-center">
      <div className="max-w-xl w-full mx-auto px-4 py-6">
      {/* 今日任务卡 */}
      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] px-5 py-5 text-center">
        <p className="text-[12px] text-[var(--text-muted)]">今日待学习</p>
        <p className="mt-1.5">
          <span className="text-[30px] font-semibold text-[var(--text-primary)] tabular-nums">{dueCount + newCount}</span>
          <span className="text-[12px] text-[var(--text-muted)] ml-2">词</span>
        </p>
        <p className="text-[11px] text-[var(--text-muted)] mt-1.5">
          {dueCount > 0 && <span className="mr-2">复习 {dueCount}</span>}
          {newCount > 0 && <span>新词 {newCount}</span>}
          {dueCount + newCount === 0 && '队列为空'}
        </p>
        <button onClick={onStartStudy} disabled={dueCount + newCount === 0}
          className="mt-4 px-6 py-2 rounded-lg text-[13px] bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-40 transition-opacity">
          开始学习
        </button>
        {dueCount + newCount === 0 && (
          <p className="text-[11px] text-[var(--text-muted)] mt-2.5 leading-relaxed">
            阅读时选中英文单词 → 点「翻译」→ 点 ⭐ 收藏，收录的词会自动进入每日队列。
          </p>
        )}
      </div>

      {/* 概况条 */}
      <div className="grid grid-cols-3 gap-2 mt-3">
        <div className="rounded-lg border border-[var(--border-color)] px-3 py-2.5 text-center">
          <p className="text-[16px] font-semibold text-[var(--text-primary)] tabular-nums flex items-center justify-center gap-1">
            <Flame size={13} className="text-orange-400" />{today.streakDays}
          </p>
          <p className="text-[10px] text-[var(--text-muted)] mt-0.5">连续天数</p>
        </div>
        <div className="rounded-lg border border-[var(--border-color)] px-3 py-2.5 text-center">
          <p className="text-[16px] font-semibold text-[var(--text-primary)] tabular-nums">{today.answeredToday}</p>
          <p className="text-[10px] text-[var(--text-muted)] mt-0.5">今日已答</p>
        </div>
        <div className="rounded-lg border border-[var(--border-color)] px-3 py-2.5 text-center">
          <p className="text-[16px] font-semibold text-[var(--text-primary)] tabular-nums">
            {book ? `${today.bookLearned}/${today.bookTotal}` : '—'}
          </p>
          <p className="text-[10px] text-[var(--text-muted)] mt-0.5">{book ? `${bookLabel}词书` : '未选词书'}</p>
        </div>
      </div>

      {/* 分区入口 */}
      <div className="grid grid-cols-3 gap-2 mt-3">
        <button onClick={onGoList}
          className="px-3 py-3 rounded-lg border border-[var(--border-color)] hover:border-[var(--accent)] transition-colors text-left">
          <p className="text-[12px] font-medium text-[var(--text-primary)]">生词本</p>
          <p className="text-[10px] text-[var(--text-muted)] mt-0.5">管理收藏的词</p>
        </button>
        <button onClick={onGoSystem}
          className="px-3 py-3 rounded-lg border border-[var(--border-color)] hover:border-[var(--accent)] transition-colors text-left">
          <p className="text-[12px] font-medium text-[var(--text-primary)]">词汇体系</p>
          <p className="text-[10px] text-[var(--text-muted)] mt-0.5">同根 / 近义 / 话题分组</p>
        </button>
        <button onClick={onGoBook} disabled={!book}
          className="px-3 py-3 rounded-lg border border-[var(--border-color)] hover:border-[var(--accent)] disabled:opacity-40 transition-colors text-left">
          <p className="text-[12px] font-medium text-[var(--text-primary)]">词书</p>
          <p className="text-[10px] text-[var(--text-muted)] mt-0.5">{book ? '浏览与斩词' : '未选择'}</p>
        </button>
      </div>
      </div>
    </div>
  )
}

// ===== 今日学习 =====

function TodayView({ today, loading, onReload, override, onExitOverride }: {
  today: WordbookTodayDto | null
  loading: boolean
  onReload: () => Promise<void>
  /** 非空 = 分组/词根/近义发起的强化复习队列，替代每日队列 */
  override: WordbookCustomQueueDto | null
  onExitOverride: () => void
}) {
  const [idx, setIdx] = useState(0)
  const [round, setRound] = useState(1)
  /** picked=已选选项；revealed 且 picked=null 表示"不会,直接看答案" */
  const [picked, setPicked] = useState<string | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [flash, setFlash] = useState<'none' | 'ok' | 'bad'>('none')
  /** 翻面后是否已记录反馈（答对自动记；翻面后手动记） */
  const [graded, setGraded] = useState<WordFeedback | null>(null)
  const [aiMd, setAiMd] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [rel, setRel] = useState<{ roots: RootClusterDto[]; synonyms: WordRelationRowDto[] } | null>(null)
  const [spellInput, setSpellInput] = useState('')
  const [done, setDone] = useState(false)
  const [doneStats, setDoneStats] = useState<WordbookStatsDto | null>(null)
  const seqRef = useRef(0)
  const advanceTimerRef = useRef<number | null>(null)

  const items = override?.items ?? today?.items ?? []
  const item = items[idx]
  const remainingReview = items.slice(idx).filter(i => !i.isNew).length
  const remainingNew = items.slice(idx).filter(i => i.isNew).length

  useEffect(() => () => { if (advanceTimerRef.current) window.clearTimeout(advanceTimerRef.current) }, [])

  const loadAi = useCallback(async (word: string) => {
    const seq = ++seqRef.current
    setAiLoading(true)
    try {
      const r: TranslateInvokeResult = await translateInvoke({ text: word, mode: 'word', ai: true })
      if (seq === seqRef.current) setAiMd(r.ok ? r.markdown : `AI 精讲失败：${r.error}`)
    } finally { if (seq === seqRef.current) setAiLoading(false) }
  }, [])

  const resetCardState = () => {
    setPicked(null); setRevealed(false); setGraded(null); setAiMd(''); setAiOpen(false)
    setSpellInput(''); setFlash('none'); setRel(null)
  }

  /** 记录反馈并短暂展示对错后进入下一张 */
  const submitGrade = useCallback((fb: WordFeedback) => {
    if (!item) return
    void wordbookAnswer(item.word, fb).then(r => {
      if (!r.ok) showToast({ type: 'error', message: r.error ?? '提交失败' })
    })
    if (advanceTimerRef.current) window.clearTimeout(advanceTimerRef.current)
    advanceTimerRef.current = window.setTimeout(() => {
      resetCardState()
      setIdx(i => i + 1)
    }, fb === 'known' && picked !== null ? 550 : 250)
  }, [item, picked])

  const advanceOnly = useCallback(() => {
    // 已记过分（翻面按过自评）仅前进；未记分按"不认识"兜底
    if (graded) { resetCardState(); setIdx(i => i + 1) }
    else submitGrade('unknown')
  }, [graded, submitGrade])

  // 翻面时：后台预取 AI 精讲（主进程有缓存，多数情况秒回）+ 自动发音 + 同根/近义关系
  useEffect(() => {
    if (!revealed || !item) return
    if (!aiMd && !aiLoading) void loadAi(item.word)
    speak(item.word)
    const seq = ++seqRef.current
    wordbookRelations(item.word).then(r => { if (seq === seqRef.current) setRel(r) }).catch(() => { /* ignore */ })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealed, item?.word])

  // listen 题出题即读
  useEffect(() => {
    if (item?.type === 'listen' && !revealed) speak(item.word)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.word, item?.type])

  const finishSession = useCallback(() => {
    // 强化队列走完 → 回每日队列；每日队列走完 → 完成页
    if (override) { onExitOverride(); return }
    setDone(true)
    void wordbookStats().then(setDoneStats)
  }, [override, onExitOverride])

  // 队列走完：自动衔接巩固轮（答错词 due=今天 会重新入队）；确认为空才进完成页
  const reloadingRef = useRef(false)
  useEffect(() => {
    if (override || loading || !today || idx < items.length || items.length === 0 || reloadingRef.current) return
    reloadingRef.current = true
    void onReload().finally(() => { reloadingRef.current = false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, items.length, today, loading])

  // 强化队列走完 → 退出回每日队列
  useEffect(() => {
    if (override && items.length > 0 && idx >= items.length) finishSession()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, items.length, override])

  // reload 结果判定：新队列非空 → 巩固轮继续；为空 → 完成页
  useEffect(() => {
    if (override || loading || !today || reloadingRef.current) return
    if (idx >= items.length && items.length > 0 && idx !== 0) {
      setIdx(0)
      setRound(r => r + 1)
    } else if (items.length === 0 && idx !== 0) {
      setIdx(0)
      finishSession()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today, loading])

  const restart = () => {
    setDone(false); setDoneStats(null); setRound(1); setIdx(0)
    resetCardState()
    void onReload()
  }

  const pickOption = (op: string) => {
    if (!item || revealed) return
    const correct = op === (item.type === 'cloze' ? item.word : item.answer)
    setPicked(op)
    setFlash(correct ? 'ok' : 'bad')
    if (correct) {
      setGraded('known')
      speak(item.type === 'cloze' ? item.word : item.word)
      submitGrade('known') // 答对自动记认识，一次点击直下
    } else {
      setRevealed(true)
    }
  }

  const checkSpell = () => {
    if (!item || revealed) return
    const ok = spellInput.trim().toLowerCase() === item.word.toLowerCase()
    setPicked(spellInput)
    setFlash(ok ? 'ok' : 'bad')
    if (ok) { setGraded('known'); submitGrade('known') }
    else { setRevealed(true); speak(item.word) }
  }

  const revealAnswer = () => { setRevealed(true); setFlash('bad'); speak(item?.word ?? '') }

  const doGrade = (fb: WordFeedback) => {
    if (graded) { advanceOnly(); return }
    setGraded(fb)
    submitGrade(fb)
  }

  /** 键盘流：1-4 选题 / f=不会 / 翻面后 1/2/3 自评、Enter=下一个 */
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!item || done) return
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return
    if (!revealed) {
      const n = Number(e.key)
      const options = item.type === 'cloze' ? item.wordOptions : item.options
      if ((item.type !== 'spell') && n >= 1 && n <= options.length) { pickOption(options[n - 1]); return }
      if (item.type === 'spell' && e.key === 'Enter') { checkSpell(); return }
      if (e.key === 'f' || e.key === 'F') revealAnswer()
    } else {
      if (e.key === '1') doGrade('known')
      else if (e.key === '2') doGrade('fuzzy')
      else if (e.key === '3' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); graded ? advanceOnly() : doGrade('unknown') }
    }
  }

  if (done) return <DoneView stats={doneStats} today={today} onRestart={restart} />
  if (!override && !today) return loading ? null : <Center text="加载失败，请稍后重试" />
  if (!item) {
    // 空队列：没有到期复习也没有可推送的新词
    if (items.length === 0 && !loading) {
      return (
        <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-6">
          <Check size={30} className="text-emerald-400" />
          <p className="text-[14px] text-[var(--text-primary)]">今日没有待学习的词</p>
          <p className="text-[12px] text-[var(--text-muted)] leading-relaxed">
            复习队列和新词队列都空着。选择一本词书推送新词，或先去划词查词收藏生词。
          </p>
        </div>
      )
    }
    return null
  }

  const examTags = item.tags.filter(t => t === 'cet4' || t === 'cet6' || t === 'ky')
  const options = item.type === 'cloze' ? item.wordOptions : item.options
  const answerText = item.type === 'cloze' ? item.word : item.answer

  return (
    <div className="max-w-xl mx-auto px-4 py-5 outline-none" onKeyDown={onKeyDown} tabIndex={-1}>
      {/* 账本与进度 */}
      <div className="flex items-center gap-2 mb-3">
        <div className="flex-1 h-1 rounded-full bg-[var(--bg-hover)] overflow-hidden">
          <div className="h-full bg-[var(--accent)] rounded-full transition-all" style={{ width: `${(idx / Math.max(1, items.length)) * 100}%` }} />
        </div>
        <span className="text-[11px] text-[var(--text-muted)] tabular-nums">{idx + 1}/{items.length}</span>
        <span className="text-[10px] text-[var(--text-muted)] whitespace-nowrap">
          {remainingReview > 0 && <span className="mr-1.5">复习 {remainingReview}</span>}
          {remainingNew > 0 && <span>新词 {remainingNew}</span>}
        </span>
        <span className="px-1.5 py-0.5 rounded text-[10px] border border-[var(--border-color)] text-[var(--text-muted)]">{TYPE_LABELS[item.type]}</span>
        {item.isNew && <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/15 text-emerald-400">新词</span>}
      </div>
      {override ? (
        <p className="text-center text-[11px] text-violet-300 mb-2">体系强化 · {override.label}（作答照常计入记忆计划）</p>
      ) : round > 1 && (
        <p className="text-center text-[11px] text-amber-400 mb-2">巩固轮 {round} · 回顾之前答错的词</p>
      )}

      {/* 题面 */}
      {item.type === 'choice' && (
        <div className="text-center py-3 cursor-pointer" onClick={() => speak(item.word)} title="点击发音">
          <p className={`text-[34px] font-semibold break-all transition-colors ${flash === 'ok' ? 'text-emerald-400' : flash === 'bad' ? 'text-red-400' : 'text-[var(--text-primary)]'}`}>{item.word}</p>
          {item.phonetic && <p className="text-[13px] text-[var(--text-muted)] mt-1">/{item.phonetic.replace(/^\/|\/$/g, '')}/</p>}
        </div>
      )}
      {item.type === 'listen' && (
        <div className="text-center py-5">
          <button onClick={() => speak(item.word)} title="再听一遍"
            className="mx-auto w-16 h-16 rounded-full bg-[var(--accent)] text-white flex items-center justify-center hover:opacity-90 transition-opacity">
            <Volume2 size={26} />
          </button>
          <p className="text-[11px] text-[var(--text-disabled)] mt-2">听发音，选出释义（点击喇叭重听）</p>
        </div>
      )}
      {item.type === 'spell' && (
        <div className="text-center py-3">
          <p className="text-[15px] text-[var(--text-primary)] leading-relaxed">{item.translationLines[0] ?? (item.definition || '(无释义)')}</p>
          {revealed ? (
            <p className={`text-[26px] font-semibold mt-2 tracking-wide ${flash === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}>{item.word}</p>
          ) : (
            <input autoFocus value={spellInput} onChange={e => setSpellInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); checkSpell() } }}
              placeholder="拼写单词后回车" spellCheck={false} autoComplete="off"
              className="mt-3 w-56 px-3 py-2 text-center text-[16px] rounded-lg border border-[var(--border-color)] bg-[var(--input-bg)] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]" />
          )}
        </div>
      )}
      {item.type === 'cloze' && (
        <div className="py-3">
          <p className="text-[14px] leading-relaxed text-[var(--text-primary)] bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg px-3.5 py-3">
            {item.clozeSentence}
          </p>
          <p className="text-[11px] text-[var(--text-disabled)] mt-2 text-center">选出填入 ____ 的单词</p>
        </div>
      )}

      {/* 选项 */}
      {item.type !== 'spell' && (
        <div className={`grid gap-2 ${item.type === 'cloze' ? 'grid-cols-2' : 'grid-cols-1 sm:grid-cols-2'}`}>
          {options.map((op, i) => {
            const isAnswer = op === answerText
            const isPicked = op === picked
            let cls = 'border-[var(--border-color)] hover:border-[var(--accent)] text-[var(--text-primary)]'
            if (revealed && isAnswer) cls = 'border-emerald-500 bg-emerald-500/10 text-emerald-300'
            else if (revealed && isPicked) cls = 'border-red-500 bg-red-500/10 text-red-300'
            else if (revealed) cls = 'border-[var(--border-color)] opacity-50 text-[var(--text-muted)]'
            return (
              <button key={`${op}-${i}`} disabled={revealed} onClick={() => pickOption(op)}
                className={`px-3 py-2.5 rounded-lg border text-left text-[12.5px] leading-relaxed transition-colors ${cls}`}>
                {item.type === 'cloze' && <span className="text-[var(--text-disabled)] mr-1.5 text-[10px]">{i + 1}</span>}
                {op}
              </button>
            )
          })}
        </div>
      )}

      {/* 不会,看答案（选择题未翻面时） */}
      {(item.type === 'choice' || item.type === 'listen') && !revealed && (
        <button onClick={revealAnswer}
          className="w-full mt-2.5 flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg border border-dashed border-[var(--border-color)] text-[12px] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--text-muted)] transition-colors">
          <Eye size={12} /> 不会，直接看答案 <span className="text-[10px] text-[var(--text-disabled)]">(F)</span>
        </button>
      )}

      {/* 翻面详情 + 自评 */}
      {revealed && (
        <div className="mt-3.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3.5 py-3">
          <div className="flex items-center gap-1.5 flex-wrap">
            {picked !== null && flash === 'bad' && <span className="text-[12px] text-red-400">答错了</span>}
            {picked === null && <span className="text-[12px] text-[var(--text-muted)]">直接看答案</span>}
            <button onClick={() => speak(item.word)} title="发音" className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><Volume2 size={12} /></button>
            {examTags.map(t => (
              <span key={t} className="px-1.5 py-0.5 rounded text-[10px] bg-[var(--accent)]/15 text-[var(--accent)]">{TAG_LABELS[t]}</span>
            ))}
            <button onClick={() => setAiOpen(o => !o)}
              className="ml-auto flex items-center gap-1 text-[11px] text-[var(--accent)] hover:opacity-80">
              <Sparkles size={11} /> AI 精讲{aiLoading ? '…' : ''}
            </button>
          </div>
          {aiOpen && (
            <div className="mt-2 text-[12px]">
              {aiLoading ? <Loader2 size={13} className="animate-spin text-[var(--text-muted)]" /> : <MarkdownPreview content={aiMd} />}
            </div>
          )}
          {!aiOpen && (
            <>
              {item.translationLines.length > 0 && (
                <ul className="mt-2 space-y-0.5">
                  {item.translationLines.slice(0, 4).map((l, i) => (
                    <li key={i} className="text-[12px] leading-relaxed text-[var(--text-secondary)]">{l}</li>
                  ))}
                </ul>
              )}
              {item.definition && <p className="mt-1.5 text-[11px] text-[var(--text-muted)] break-words">{item.definition}</p>}
              {EXCHANGE_ROWS.some(([k]) => item.exchange[k]) && (
                <div className="flex items-center gap-1 flex-wrap mt-2">
                  {EXCHANGE_ROWS.filter(([k]) => item.exchange[k]).map(([k, label]) => (
                    <span key={k} className="px-1.5 py-0.5 rounded text-[10px] border border-[var(--border-color)] text-[var(--text-secondary)]">
                      {label} <span className="text-[var(--text-primary)]">{item.exchange[k]}</span>
                    </span>
                  ))}
                </div>
              )}
              {/* 同根词（体系强化入口） */}
              {rel && rel.roots.length > 0 && (
                <div className="mt-2">
                  {rel.roots.map(rc => (
                    <div key={rc.root} className="flex items-start gap-1.5 flex-wrap mt-1">
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-violet-500/15 text-violet-300 shrink-0"
                        title={`${rc.origin} 词根 · ${rc.meaning}`}>
                        词根 {rc.root}{rc.meaning ? ` · ${rc.meaning}` : ''}
                      </span>
                      {rc.words.slice(0, 8).map(w => (
                        <button key={w.word} onClick={() => speak(w.word)} title={w.translationLine}
                          className={`px-1.5 py-0.5 rounded text-[10px] transition-colors ${w.status !== 'none'
                            ? 'bg-[var(--accent)]/15 text-[var(--accent)]'
                            : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}>
                          {w.word}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              )}
              {/* 近义词 */}
              {rel && rel.synonyms.length > 0 && (
                <div className="flex items-start gap-1.5 flex-wrap mt-1">
                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-sky-500/15 text-sky-300 shrink-0">近义</span>
                  {rel.synonyms.map(w => (
                    <button key={w.word} onClick={() => speak(w.word)} title={w.translationLine}
                      className={`px-1.5 py-0.5 rounded text-[10px] transition-colors ${w.status !== 'none'
                        ? 'bg-[var(--accent)]/15 text-[var(--accent)]'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}>
                      {w.word}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          <div className="mt-3 flex items-center gap-2">
            <span className="text-[11px] text-[var(--text-muted)]">我记得：</span>
            <GradeBtn label="认识" hot active={graded === 'known'} onClick={() => doGrade('known')} />
            <GradeBtn label="模糊" active={graded === 'fuzzy'} onClick={() => doGrade('fuzzy')} />
            <GradeBtn label="不认识" active={graded === 'unknown'} onClick={() => doGrade('unknown')} />
          </div>
        </div>
      )}
    </div>
  )
}

function GradeBtn({ label, active, hot, onClick }: { label: string; active?: boolean; hot?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={`px-3.5 py-1.5 rounded-md text-[12px] transition-colors ${active
        ? 'bg-[var(--accent)] text-white'
        : hot
          ? 'border border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent)]/10'
          : 'border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--text-muted)]'}`}>
      {label}
    </button>
  )
}

/** 完成页：庆祝 + 今日小结 + 近 7 天趋势 + 打卡联动提示 */
function DoneView({ stats, today, onRestart }: { stats: WordbookStatsDto | null; today: WordbookTodayDto | null; onRestart: () => void }) {
  const last7 = useMemo(() => {
    const map = new Map((stats?.recent ?? []).map(r => [r.date, r]))
    const days: { date: string; total: number }[] = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i)
      const p = (n: number) => String(n).padStart(2, '0')
      const key = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
      const r = map.get(key)
      days.push({ date: key.slice(5), total: (r?.new_words ?? 0) + (r?.reviewed ?? 0) })
    }
    return days
  }, [stats])
  const maxTotal = Math.max(1, ...last7.map(d => d.total))

  return (
    <div className="h-full flex flex-col items-center justify-center gap-4 text-center px-6 py-8">
      <div className="w-16 h-16 rounded-full bg-emerald-500/15 flex items-center justify-center animate-bounce">
        <Check size={30} className="text-emerald-400" />
      </div>
      <div>
        <p className="text-[16px] text-[var(--text-primary)] font-medium">今日队列完成！</p>
        <p className="text-[12px] text-[var(--text-muted)] mt-1.5 leading-relaxed">
          新词 {today?.newDone ?? 0}/{today?.newTarget ?? 0} · 今日共答 {stats?.answeredToday ?? today?.answeredToday ?? 0} 题 · 连续 <span className="text-orange-400">{stats?.streakDays ?? 0}</span> 天
        </p>
      </div>
      {/* 近 7 天趋势 */}
      <div className="flex items-end gap-1.5 h-16">
        {last7.map(d => (
          <div key={d.date} className="flex flex-col items-center gap-1 w-8" title={`${d.date}: ${d.total} 词`}>
            <span className="text-[9px] text-[var(--text-disabled)] tabular-nums">{d.total || ''}</span>
            <div className="w-full rounded-t bg-[var(--accent)]/70" style={{ height: `${Math.max(3, (d.total / maxTotal) * 44)}px` }} />
            <span className="text-[9px] text-[var(--text-muted)]">{d.date}</span>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-[var(--text-muted)] leading-relaxed max-w-72">
        想让背单词自动打卡？到「习惯打卡」新建习惯，联动来源选「背单词」并设置每日词数即可。
      </p>
      <button onClick={onRestart}
        className="px-4 py-1.5 rounded-md text-[12px] bg-[var(--accent)] text-white hover:opacity-90 transition-opacity">
        再检查一轮
      </button>
    </div>
  )
}

function Center({ text }: { text: string }) {
  return <div className="h-full flex items-center justify-center text-[12px] text-[var(--text-muted)]">{text}</div>
}

// ===== 生词本列表 =====

function ListView({ onReload, onWordClick, version }: { onReload: () => Promise<void>; onWordClick: (w: string) => void; version: number }) {
  const [entries, setEntries] = useState<WordbookEntryDto[]>([])
  const [filter, setFilter] = useState<'all' | 'learning' | 'mastered'>('all')
  const [sortBy, setSortBy] = useState<'added' | 'alpha' | 'due'>('added')
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const [newWord, setNewWord] = useState('')

  const reload = useCallback(async () => {
    try { setEntries(await wordbookList()) } catch { /* keep */ }
  }, [])
  useEffect(() => { void reload() }, [reload, version])

  const add = async () => {
    const w = newWord.trim().toLowerCase()
    if (!w) return
    // 离线词典校验：查不到的词不收，避免拼错的词污染生词本
    const dict = await dictLookup(w)
    if (!dict.found) {
      showToast({ type: 'warning', message: `「${w}」不在离线词典中，请检查拼写` })
      return
    }
    setAdding(true)
    try {
      const r = await wordbookAdd(w)
      showToast({ type: 'info', message: r.already ? `「${w}」已在生词本` : `已加入生词本：${w}` })
      setNewWord('')
      await reload()
      await onReload()
    } finally { setAdding(false) }
  }

  /** 排序 + 字母分组 */
  const { flat, groups } = useMemo(() => {
    const filtered = entries.filter(e =>
      (filter === 'all' || e.status === filter) && (!q || e.word.includes(q.toLowerCase())))
    if (sortBy === 'alpha') {
      const sorted = [...filtered].sort((a, b) => a.word.localeCompare(b.word))
      const map = new Map<string, WordbookEntryDto[]>()
      for (const e of sorted) {
        const letter = e.word[0].toUpperCase()
        if (!map.has(letter)) map.set(letter, [])
        map.get(letter)!.push(e)
      }
      return { flat: null as WordbookEntryDto[] | null, groups: [...map.entries()] }
    }
    if (sortBy === 'due') filtered.sort((a, b) => (a.dueAt || '').localeCompare(b.dueAt || ''))
    return { flat: filtered, groups: null }
  }, [entries, filter, q, sortBy])

  return (
    <div className="max-w-2xl mx-auto px-4 py-4">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {(['all', 'learning', 'mastered'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-2.5 py-1 rounded-md text-[11px] transition-colors ${filter === f
              ? 'bg-[var(--bg-selected)] text-[var(--text-primary)]'
              : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}`}>
            {{ all: '全部', learning: '学习中', mastered: '已斩' }[f]}
          </button>
        ))}
        <label className="flex items-center gap-1 text-[11px] text-[var(--text-muted)]" title="排序方式">
          <ArrowUpDown size={11} />
          <select value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)}
            className="px-1.5 py-1 rounded-md border border-[var(--border-color)] bg-[var(--input-bg)] text-[11px] text-[var(--text-secondary)] outline-none">
            <option value="added">最近添加</option>
            <option value="alpha">字母顺序</option>
            <option value="due">复习到期</option>
          </select>
        </label>
        <div className="ml-auto flex items-center gap-1.5">
          <input value={newWord} onChange={e => setNewWord(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void add() }}
            placeholder="手动添加单词…"
            className="w-36 px-2 py-1 rounded-md border border-[var(--border-color)] bg-[var(--input-bg)] text-[11px] outline-none focus:border-[var(--accent)]" />
          <button onClick={() => void add()} disabled={adding || !newWord.trim()}
            className="p-1.5 rounded-md bg-[var(--accent)] text-white disabled:opacity-40 hover:opacity-90 transition-opacity" title="加入生词本">
            <Plus size={12} />
          </button>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="搜索…"
            className="w-28 px-2 py-1 rounded-md border border-[var(--border-color)] bg-[var(--input-bg)] text-[11px] outline-none focus:border-[var(--accent)]" />
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="py-16 text-center text-[12px] text-[var(--text-muted)] leading-relaxed">
          生词本还是空的。<br />
          在任意页面选中英文单词点「翻译」，卡片上点 <Star size={11} className="inline text-[var(--accent)]" /> 即可收藏。
        </div>
      ) : groups ? (
        /* 字母分组视图 */
        <div className="space-y-3">
          {groups.map(([letter, list]) => (
            <div key={letter}>
              <p className="text-[11px] font-semibold text-[var(--text-muted)] mb-1 pl-1">{letter} <span className="text-[var(--text-disabled)]">({list.length})</span></p>
              <div className="space-y-1">
                {list.map(e => <EntryRow key={e.word} e={e} onWordClick={onWordClick} onReload={reload} />)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-1">
          {flat!.map(e => <EntryRow key={e.word} e={e} onWordClick={onWordClick} onReload={reload} />)}
        </div>
      )}
    </div>
  )
}

function EntryRow({ e, onWordClick, onReload }: { e: WordbookEntryDto; onWordClick: (w: string) => void; onReload: () => Promise<void> }) {
  return (
    <div className="group flex items-center gap-2.5 px-3 py-2 rounded-lg border border-[var(--border-color)] hover:bg-[var(--bg-hover)] transition-colors">
      <button onClick={() => speak(e.word)} title="发音"
        className="shrink-0 text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors">
        <Volume2 size={13} />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => onWordClick(e.word)} title="查看详情"
            className="text-[13px] font-medium text-[var(--text-primary)] hover:text-[var(--accent)] transition-colors">{e.word}</button>
          {e.phonetic && <span className="text-[10px] text-[var(--text-muted)]">/{e.phonetic.replace(/^\/|\/$/g, '')}/</span>}
          {e.status === 'mastered'
            ? <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-500/15 text-amber-400">已斩</span>
            : e.streak >= 3 && <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/15 text-emerald-400">连对 {e.streak}</span>}
          {e.tags.filter(t => t === 'cet4' || t === 'cet6' || t === 'ky').map(t => (
            <span key={t} className="px-1 py-0.5 rounded text-[9px] bg-[var(--accent)]/15 text-[var(--accent)]">{TAG_LABELS[t]}</span>
          ))}
        </div>
        <p className="text-[11px] text-[var(--text-muted)] truncate mt-0.5">
          {e.translationLines[0] ?? '(词典未收录)'}
          {e.status === 'learning' && ` · 下次复习 ${e.dueAt.slice(5, 10)}`}
        </p>
      </div>
      <button onClick={async () => { await wordbookSetMastered(e.word, e.status !== 'mastered'); await onReload() }}
        title={e.status === 'mastered' ? '恢复学习' : '斩词：已掌握，移出复习计划'}
        className={`shrink-0 p-1.5 rounded-md opacity-0 group-hover:opacity-100 transition-opacity ${e.status === 'mastered'
          ? 'text-amber-400 hover:bg-[var(--bg-selected)]'
          : 'text-[var(--text-muted)] hover:text-amber-400 hover:bg-[var(--bg-selected)]'}`}>
        {e.status === 'mastered' ? <RotateCcw size={12} /> : <Zap size={12} />}
      </button>
      <button onClick={async () => { await wordbookRemove(e.word); await onReload() }}
        title="从生词本删除"
        className="shrink-0 p-1.5 rounded-md text-[var(--text-muted)] opacity-0 group-hover:opacity-100 hover:text-red-400 transition-colors">
        <Trash2 size={12} />
      </button>
    </div>
  )
}

// ===== 词书浏览 =====

function BookView({ onWordClick, version }: { onWordClick: (w: string) => void; version: number }) {
  const { s } = useSettings()
  const book = s.wordbookActiveBook as WordbookBook
  const [q, setQ] = useState('')
  const [orderBy, setOrderBy] = useState<'frq' | 'word'>('frq')
  const [rows, setRows] = useState<BookWordRowDto[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const load = useCallback(async (offset: number) => {
    if (!book) return
    setLoading(true)
    try {
      const r = await wordbookBookWords(book, q, offset, 100, orderBy)
      setTotal(r.total)
      setRows(prev => offset === 0 ? r.items : [...prev, ...r.items])
    } finally { setLoading(false) }
  }, [book, q, orderBy])

  useEffect(() => { void load(0) }, [load, version, reloadKey])

  if (!book) return <Center text="先在顶部选择一本词书" />

  /** 字母序时按首字母分段 */
  const sections = orderBy === 'word'
    ? (() => {
      const map = new Map<string, BookWordRowDto[]>()
      for (const r of rows) {
        const letter = r.word[0].toUpperCase()
        if (!map.has(letter)) map.set(letter, [])
        map.get(letter)!.push(r)
      }
      return [...map.entries()]
    })()
    : null

  return (
    <div className="max-w-2xl mx-auto px-4 py-4">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <p className="text-[11px] text-[var(--text-muted)]">
          共 {total} 词 · {orderBy === 'frq' ? '按词频排序' : '按字母排序'} · 点单词查看详情
        </p>
        <div className="flex items-center gap-0.5 ml-auto">
          {([['frq', '词频'], ['word', '字母']] as const).map(([v, label]) => (
            <button key={v} onClick={() => setOrderBy(v)}
              className={`px-2 py-1 rounded-md text-[11px] transition-colors ${orderBy === v
                ? 'bg-[var(--bg-selected)] text-[var(--text-primary)]'
                : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}`}>
              {label}
            </button>
          ))}
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="搜索单词…"
            className="w-36 px-2 py-1 rounded-md border border-[var(--border-color)] bg-[var(--input-bg)] text-[11px] outline-none focus:border-[var(--accent)]" />
        </div>
      </div>
      {sections ? (
        <div className="space-y-3">
          {sections.map(([letter, list]) => (
            <div key={letter}>
              <p className="text-[11px] font-semibold text-[var(--text-muted)] mb-1 pl-1">{letter}</p>
              <div className="space-y-0.5">
                {list.map(r => <BookRow key={r.word} r={r} onWordClick={onWordClick} onChanged={() => setReloadKey(k => k + 1)} />)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-0.5">
          {rows.map(r => <BookRow key={r.word} r={r} onWordClick={onWordClick} onChanged={() => setReloadKey(k => k + 1)} />)}
        </div>
      )}
      {rows.length < total && (
        <button onClick={() => void load(rows.length)} disabled={loading}
          className="w-full mt-3 py-1.5 rounded-md border border-dashed border-[var(--border-color)] text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors flex items-center justify-center gap-1">
          {loading ? <Loader2 size={11} className="animate-spin" /> : <ChevronDown size={11} />} 加载更多（{rows.length}/{total}）
        </button>
      )}
      {rows.length === 0 && !loading && <Center text="没有匹配的单词" />}
    </div>
  )
}

function BookRow({ r, onWordClick, onChanged }: { r: BookWordRowDto; onWordClick: (w: string) => void; onChanged: () => void }) {
  return (
    <div className="group flex items-center gap-2.5 px-3 py-1.5 rounded-lg hover:bg-[var(--bg-hover)] transition-colors">
      <button onClick={() => speak(r.word)} title="发音"
        className="shrink-0 text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"><Volume2 size={12} /></button>
      <button onClick={() => onWordClick(r.word)} title="查看详情"
        className="text-[12.5px] font-medium text-[var(--text-primary)] w-32 shrink-0 truncate text-left hover:text-[var(--accent)] transition-colors">{r.word}</button>
      {r.phonetic && <span className="text-[10px] text-[var(--text-muted)] w-24 shrink-0 truncate">/{r.phonetic}/</span>}
      <span className="text-[11px] text-[var(--text-muted)] min-w-0 flex-1 truncate">{r.translationLine}</span>
      {r.status === 'mastered' ? (
        <button onClick={() => { void wordbookSetMastered(r.word, false).then(onChanged) }}
          className="shrink-0 px-2 py-0.5 rounded text-[10px] bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 transition-colors">
          已斩·恢复
        </button>
      ) : r.status === 'learning' ? (
        <span className="shrink-0 px-2 py-0.5 rounded text-[10px] bg-emerald-500/15 text-emerald-400">学习中</span>
      ) : (
        <button onClick={() => { void wordbookMarkKnown(r.word).then(onChanged) }}
          className="shrink-0 px-2 py-0.5 rounded text-[10px] border border-[var(--border-color)] text-[var(--text-muted)] opacity-0 group-hover:opacity-100 hover:text-amber-400 hover:border-amber-400/50 transition-all" title="标记为已认识（斩词，不再推送）">
          已认识
        </button>
      )}
    </div>
  )
}

// ===== 词汇体系：同根词 / 近义词 / 话题分组 =====

function SystemView({ onStartCustom, onWordClick, version }: {
  onStartCustom: (label: string, words: string[]) => Promise<void>
  onWordClick: (w: string) => void
  version: number
}) {
  const [roots, setRoots] = useState<RootClusterDto[] | null>(null)
  const [syns, setSyns] = useState<SynonymClusterDto[] | null>(null)

  useEffect(() => {
    wordbookRootClusters().then(setRoots).catch(() => setRoots([]))
    wordbookSynonymClusters().then(setSyns).catch(() => setSyns([]))
  }, [version])

  return (
    <div className="max-w-2xl mx-auto px-4 py-4 space-y-6">
      <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
        把生词本里的词按<b>词根</b>、<b>近义</b>自动聚类，也可以自建<b>话题分组</b>（如「经济类」）。
        点「强化复习」整组一起过，作答照常计入记忆计划。
      </p>

      {/* 词根聚类 */}
      <section>
        <h3 className="text-[12px] font-semibold text-[var(--text-primary)] mb-1.5">同根词</h3>
        {roots === null ? (
          <Center text="加载中…" />
        ) : roots.length === 0 ? (
          <p className="text-[11px] text-[var(--text-disabled)] py-2">生词本里还没有能按词根成簇的词（至少两个同根词才会聚成一簇）。</p>
        ) : (
          <div className="space-y-1.5">
            {roots.map(rc => (
              <ClusterCard
                key={rc.root}
                tag={`词根 ${rc.root}`}
                tagColor="bg-violet-500/15 text-violet-300"
                note={[rc.origin, rc.meaning].filter(Boolean).join(' · ')}
                words={rc.words}
                onWordClick={onWordClick}
                onStart={() => void onStartCustom(`词根 ${rc.root}`, rc.words.map(w => w.word))}
              />
            ))}
          </div>
        )}
      </section>

      {/* 近义聚类 */}
      <section>
        <h3 className="text-[12px] font-semibold text-[var(--text-primary)] mb-1.5">近义词</h3>
        {syns === null ? (
          <Center text="加载中…" />
        ) : syns.length === 0 ? (
          <p className="text-[11px] text-[var(--text-disabled)] py-2">生词本里还没有能按近义成簇的词。</p>
        ) : (
          <div className="space-y-1.5">
            {syns.map((sc, i) => (
              <ClusterCard
                key={i}
                tag="近义组"
                tagColor="bg-sky-500/15 text-sky-300"
                note=""
                words={sc.words}
                onWordClick={onWordClick}
                onStart={() => void onStartCustom('近义词组', sc.words.map(w => w.word))}
              />
            ))}
          </div>
        )}
      </section>

      <GroupsSection onStartCustom={onStartCustom} onWordClick={onWordClick} />
    </div>
  )
}

function ClusterCard({ tag, tagColor, note, words, onStart, onWordClick }: {
  tag: string
  tagColor: string
  note: string
  words: WordRelationRowDto[]
  onStart: () => void
  onWordClick: (w: string) => void
}) {
  return (
    <div className="px-3 py-2.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--bg-hover)] transition-colors">
      <div className="flex items-center gap-2 mb-1.5">
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${tagColor}`}>{tag}</span>
        {note && <span className="text-[10px] text-[var(--text-muted)] truncate">{note}</span>}
        <button onClick={onStart}
          className="ml-auto shrink-0 px-2 py-0.5 rounded text-[10px] bg-[var(--accent)] text-white hover:opacity-90 transition-opacity">
          强化复习（{words.length}）
        </button>
      </div>
      <div className="flex items-center gap-1 flex-wrap">
        {words.map(w => (
          <button key={w.word} onClick={() => onWordClick(w.word)} title={`${w.translationLine} · 点击查看详情`}
            className={`px-1.5 py-0.5 rounded text-[11px] transition-colors ${w.status === 'mastered'
              ? 'text-amber-400/80 line-through hover:text-amber-300'
              : w.status === 'learning'
                ? 'bg-[var(--accent)]/15 text-[var(--accent)] hover:bg-[var(--accent)]/25'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>
            {w.word}
          </button>
        ))}
      </div>
    </div>
  )
}

function GroupsSection({ onStartCustom, onWordClick }: {
  onStartCustom: (label: string, words: string[]) => Promise<void>
  onWordClick: (w: string) => void
}) {
  const [groups, setGroups] = useState<WordbookGroupDto[]>([])
  const [name, setName] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [openWords, setOpenWords] = useState<string[]>([])
  const [addWord, setAddWord] = useState('')

  const reload = useCallback(async () => {
    try { setGroups(await wordbookGroupsList()) } catch { /* keep */ }
  }, [])
  useEffect(() => { void reload() }, [reload])

  const openGroup = async (id: string) => {
    if (openId === id) { setOpenId(null); return }
    setOpenId(id)
    try { setOpenWords(await wordbookGroupsWords(id)) } catch { setOpenWords([]) }
  }

  const create = async () => {
    const n = name.trim()
    if (!n) return
    const r = await wordbookGroupsCreate(n)
    if (!r.ok) { showToast({ type: 'error', message: r.error ?? '创建失败' }); return }
    setName('')
    await reload()
  }

  return (
    <section>
      <h3 className="text-[12px] font-semibold text-[var(--text-primary)] mb-1.5">话题分组</h3>
      <div className="flex items-center gap-1.5 mb-2">
        <input value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void create() }}
          placeholder="新建分组，如「经济类」「法律类」…"
          className="flex-1 max-w-64 px-2 py-1 rounded-md border border-[var(--border-color)] bg-[var(--input-bg)] text-[11px] outline-none focus:border-[var(--accent)]" />
        <button onClick={() => void create()} disabled={!name.trim()}
          className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] bg-[var(--accent)] text-white disabled:opacity-40 hover:opacity-90 transition-opacity">
          <Plus size={11} /> 新建
        </button>
      </div>
      {groups.length === 0 ? (
        <p className="text-[11px] text-[var(--text-disabled)] py-1">还没有分组。</p>
      ) : (
        <div className="space-y-1.5">
          {groups.map(g => (
            <div key={g.id} className="px-3 py-2.5 rounded-lg border border-[var(--border-color)]">
              <div className="flex items-center gap-2">
                <button onClick={() => void openGroup(g.id)} className="flex items-center gap-1.5 min-w-0 flex-1 text-left">
                  <ChevronDown size={11} className={`text-[var(--text-muted)] transition-transform ${openId === g.id ? '' : '-rotate-90'}`} />
                  <span className="text-[12px] font-medium text-[var(--text-primary)] truncate">{g.name}</span>
                  <span className="text-[10px] text-[var(--text-muted)]">{g.wordCount} 词</span>
                </button>
                {g.wordCount > 0 && (
                  <button onClick={() => void wordbookGroupsWords(g.id).then(ws => onStartCustom(g.name, ws))}
                    className="shrink-0 px-2 py-0.5 rounded text-[10px] bg-[var(--accent)] text-white hover:opacity-90 transition-opacity">
                    强化复习
                  </button>
                )}
                <button onClick={async () => { await wordbookGroupsDelete(g.id); if (openId === g.id) setOpenId(null); await reload() }}
                  title="删除分组"
                  className="shrink-0 p-1 rounded text-[var(--text-muted)] hover:text-red-400 transition-colors">
                  <Trash2 size={11} />
                </button>
              </div>
              {openId === g.id && (
                <div className="mt-2 pt-2 border-t border-[var(--border-color)]">
                  <div className="flex items-center gap-1 flex-wrap">
                    {openWords.length === 0 && <span className="text-[10px] text-[var(--text-disabled)]">还没有词，在下面添加。</span>}
                    {openWords.map(w => (
                      <span key={w} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] bg-[var(--bg-hover)] text-[var(--text-secondary)]">
                        <button onClick={() => onWordClick(w)} title="查看详情" className="hover:text-[var(--text-primary)]">{w}</button>
                        <button onClick={async () => { await wordbookGroupsRemoveWord(g.id, w); setOpenWords(ws => ws.filter(x => x !== w)); await reload() }}
                          title="移出分组" className="text-[var(--text-disabled)] hover:text-red-400">×</button>
                      </span>
                    ))}
                  </div>
                  <div className="flex items-center gap-1.5 mt-2">
                    <input value={addWord} onChange={e => setAddWord(e.target.value)}
                      onKeyDown={async e => {
                        if (e.key !== 'Enter' || !addWord.trim()) return
                        const r = await wordbookGroupsAddWord(g.id, addWord.trim().toLowerCase())
                        if (!r.ok) { showToast({ type: 'error', message: r.error ?? '添加失败' }); return }
                        setAddWord('')
                        setOpenWords(await wordbookGroupsWords(g.id)); await reload()
                      }}
                      placeholder="输入单词加入分组…"
                      className="w-44 px-2 py-1 rounded-md border border-[var(--border-color)] bg-[var(--input-bg)] text-[11px] outline-none focus:border-[var(--accent)]" />
                    <span className="text-[10px] text-[var(--text-disabled)]">回车添加（自动校验拼写）</span>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

