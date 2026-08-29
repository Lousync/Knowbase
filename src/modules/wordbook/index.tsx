import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Star, Zap, Trash2, RotateCcw, Plus, Sparkles, Check, Flame } from 'lucide-react'
import { useSettings } from '../../lib/SettingsContext'
import { showToast } from '../../lib/toast'
import {
  wordbookGetToday, wordbookAnswer, wordbookSetBook, wordbookList, wordbookRemove,
  wordbookSetMastered, wordbookAdd, translateInvoke,
} from '../../lib/ipc'
import type { WordbookTodayDto, WordbookEntryDto, WordbookBook, WordFeedback, TranslateInvokeResult } from '../../types'
import { MarkdownPreview } from '../../components/shared/MarkdownPreview'

/**
 * 单词本模块（第一期）：每日队列（到期复习+词书新词）四选一学习、
 * 三档反馈（认识/模糊/不认识）驱动简化 SM-2、生词本管理、词书进度。
 */

const BOOKS: { id: WordbookBook; label: string }[] = [
  { id: 'cet4', label: 'CET-4' },
  { id: 'cet6', label: 'CET-6' },
  { id: 'ky', label: '考研' },
]

const TAG_LABELS: Record<string, string> = { cet4: '四级', cet6: '六级', ky: '考研', toefl: '托福', ielts: '雅思', gre: 'GRE', gk: '高考', zk: '中考' }

export function WordbookModule() {
  const { s, update } = useSettings()
  const [view, setView] = useState<'today' | 'list'>('today')
  const [today, setToday] = useState<WordbookTodayDto | null>(null)
  const [loading, setLoading] = useState(true)

  const reloadToday = useCallback(async () => {
    setLoading(true)
    try { setToday(await wordbookGetToday()) } catch { setToday(null) } finally { setLoading(false) }
  }, [])
  useEffect(() => { void reloadToday() }, [reloadToday])

  const setBook = async (book: WordbookBook | '') => {
    await wordbookSetBook(book)
    await update('wordbookActiveBook', book)
    void reloadToday()
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* 顶栏：词书 + 进度 + 今日概况 */}
      <div className="shrink-0 px-4 py-2.5 border-b border-[var(--border-color)] flex items-center gap-3 flex-wrap">
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
          <div className="flex items-center gap-2 min-w-40">
            <div className="flex-1 h-1.5 rounded-full bg-[var(--bg-hover)] overflow-hidden min-w-24">
              <div className="h-full bg-[var(--accent)] rounded-full transition-all"
                style={{ width: `${today.bookTotal ? Math.min(100, (today.bookLearned / today.bookTotal) * 100) : 0}%` }} />
            </div>
            <span className="text-[11px] text-[var(--text-muted)] tabular-nums">{today.bookLearned}/{today.bookTotal}</span>
          </div>
        )}
        {today && (
          <span className="flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
            <Flame size={11} className="text-orange-400" /> 连续 {today.streakDays} 天 · 今日已答 {today.answeredToday}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <label className="flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
            每日新词
            <input type="number" min={0} max={200} value={s.wordbookNewPerDay}
              onChange={e => { const n = Math.max(0, Math.min(200, Math.floor(Number(e.target.value) || 0))); void update('wordbookNewPerDay', n) }}
              className="w-14 px-1.5 py-0.5 rounded border border-[var(--border-color)] bg-[var(--input-bg)] text-[11px] text-[var(--text-primary)] outline-none" />
          </label>
          <button onClick={() => setView(view === 'today' ? 'list' : 'today')}
            className={`px-2.5 py-1 rounded-md text-[11px] transition-colors ${view === 'list'
              ? 'bg-[var(--bg-selected)] text-[var(--text-primary)]'
              : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}`}>
            {view === 'today' ? '生词本' : '返回学习'}
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading ? (
          <div className="h-full flex items-center justify-center text-[var(--text-muted)]"><Loader2 size={18} className="animate-spin" /></div>
        ) : view === 'today' ? (
          <TodayView today={today} onReload={reloadToday} />
        ) : (
          <ListView onReload={reloadToday} />
        )}
      </div>
    </div>
  )
}

// ===== 今日学习 =====

function TodayView({ today, onReload }: { today: WordbookTodayDto | null; onReload: () => Promise<void> }) {
  const [idx, setIdx] = useState(0)
  const [picked, setPicked] = useState<string | null>(null)
  const [aiMd, setAiMd] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const seqRef = useRef(0)

  const items = today?.items ?? []
  const item = items[idx]

  // 队列耗尽后再拉一次：答错的词 due=今天 会重新进队列（防重入，避免空队列时循环拉取）
  const reloadingRef = useRef(false)
  useEffect(() => {
    if (today && items.length > 0 && idx >= items.length && !reloadingRef.current) {
      reloadingRef.current = true
      void onReload().then(() => { setIdx(0); reloadingRef.current = false })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, items.length, today])

  const resetAi = () => { setAiMd(''); setAiOpen(false); seqRef.current++ }

  const advance = () => { setPicked(null); resetAi(); setIdx(i => i + 1) }

  const grade = async (fb: WordFeedback) => {
    if (!item) return
    const r = await wordbookAnswer(item.word, fb)
    if (!r.ok) { showToast({ type: 'error', message: r.error ?? '提交失败' }); return }
    advance()
  }

  const loadAi = async () => {
    if (!item) return
    const seq = ++seqRef.current
    setAiOpen(true)
    setAiLoading(true)
    try {
      const r: TranslateInvokeResult = await translateInvoke({ text: item.word, mode: 'word', ai: true })
      if (seq === seqRef.current) setAiMd(r.ok ? r.markdown : `AI 精讲失败：${r.error}`)
    } finally { if (seq === seqRef.current) setAiLoading(false) }
  }

  if (!today) return <Empty text="加载失败，请稍后重试" />
  if (!item) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-6">
        <Zap size={32} className="text-[var(--accent)]" />
        <p className="text-[15px] text-[var(--text-primary)] font-medium">今日队列已完成</p>
        <p className="text-[12px] text-[var(--text-muted)] leading-relaxed">
          今日已答 {today.answeredToday} 题 · 新词 {today.newDone}/{today.newTarget} · 连续 {today.streakDays} 天<br />
          答错的词今天稍后会再次出现，届时回到本页即可
        </p>
      </div>
    )
  }

  const correct = picked === item.answer

  return (
    <div className="max-w-xl mx-auto px-4 py-6">
      {/* 进度 */}
      <div className="flex items-center gap-2 mb-4">
        <div className="flex-1 h-1 rounded-full bg-[var(--bg-hover)] overflow-hidden">
          <div className="h-full bg-[var(--accent)] rounded-full transition-all" style={{ width: `${(idx / Math.max(1, items.length)) * 100}%` }} />
        </div>
        <span className="text-[11px] text-[var(--text-muted)] tabular-nums">{idx + 1}/{items.length}</span>
        {item.isNew && <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/15 text-emerald-400">新词</span>}
      </div>

      {/* 题面 */}
      <div className="text-center py-4">
        <p className="text-[34px] font-semibold text-[var(--text-primary)] break-all">{item.word}</p>
        {item.phonetic && <p className="text-[13px] text-[var(--text-muted)] mt-1">/{item.phonetic.replace(/^\/|\/$/g, '')}/</p>}
        <p className="text-[11px] text-[var(--text-disabled)] mt-2">选出正确的中文释义</p>
      </div>

      {/* 选项 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {item.options.map(op => {
          const revealed = picked !== null
          const isAnswer = op === item.answer
          const isPicked = op === picked
          let cls = 'border-[var(--border-color)] hover:border-[var(--accent)] text-[var(--text-primary)]'
          if (revealed && isAnswer) cls = 'border-emerald-500 bg-emerald-500/10 text-emerald-300'
          else if (revealed && isPicked) cls = 'border-red-500 bg-red-500/10 text-red-300'
          else if (revealed) cls = 'border-[var(--border-color)] opacity-50 text-[var(--text-muted)]'
          return (
            <button key={op} disabled={revealed}
              onClick={() => setPicked(op)}
              className={`px-3 py-2.5 rounded-lg border text-left text-[12.5px] leading-relaxed transition-colors ${cls}`}>
              {op}
            </button>
          )
        })}
      </div>

      {/* 答后：详情 + 自评 */}
      {picked !== null && (
        <div className="mt-4 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3.5 py-3">
          <div className="flex items-center gap-1.5 flex-wrap">
            {correct
              ? <span className="flex items-center gap-1 text-[12px] text-emerald-400"><Check size={12} /> 答对了</span>
              : <span className="text-[12px] text-red-400">答错了，正确释义已高亮</span>}
            {item.tags.filter(t => TAG_LABELS[t] && (t === 'cet4' || t === 'cet6' || t === 'ky')).map(t => (
              <span key={t} className="px-1.5 py-0.5 rounded text-[10px] bg-[var(--accent)]/15 text-[var(--accent)]">{TAG_LABELS[t]}</span>
            ))}
            <button onClick={() => (aiOpen ? setAiOpen(false) : void loadAi())}
              className="ml-auto flex items-center gap-1 text-[11px] text-[var(--accent)] hover:opacity-80">
              <Sparkles size={11} /> AI 精讲
            </button>
          </div>
          {aiOpen && (
            <div className="mt-2 text-[12px]">
              {aiLoading ? <Loader2 size={13} className="animate-spin text-[var(--text-muted)]" /> : <MarkdownPreview content={aiMd} />}
            </div>
          )}
          {!aiOpen && item.translationLines.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {item.translationLines.slice(0, 3).map((l, i) => (
                <li key={i} className="text-[12px] leading-relaxed text-[var(--text-secondary)]">{l}</li>
              ))}
            </ul>
          )}

          <div className="mt-3 flex items-center gap-2">
            <span className="text-[11px] text-[var(--text-muted)]">我记得：</span>
            <GradeBtn label="认识" active={correct && picked !== null && picked === item.answer} hot
              onClick={() => void grade('known')} />
            <GradeBtn label="模糊" onClick={() => void grade('fuzzy')} />
            <GradeBtn label="不认识" active={!correct} onClick={() => void grade('unknown')} />
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

function Empty({ text }: { text: string }) {
  return <div className="h-full flex items-center justify-center text-[12px] text-[var(--text-muted)]">{text}</div>
}

// ===== 生词本列表 =====

function ListView({ onReload }: { onReload: () => Promise<void> }) {
  const [entries, setEntries] = useState<WordbookEntryDto[]>([])
  const [filter, setFilter] = useState<'all' | 'learning' | 'mastered'>('all')
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const [newWord, setNewWord] = useState('')

  const reload = useCallback(async () => {
    try { setEntries(await wordbookList()) } catch { /* keep */ }
  }, [])
  useEffect(() => { void reload() }, [reload])

  const add = async () => {
    const w = newWord.trim().toLowerCase()
    if (!w) return
    setAdding(true)
    try {
      const r = await wordbookAdd(w)
      showToast({ type: 'info', message: r.already ? `「${w}」已在生词本` : `已加入生词本：${w}` })
      setNewWord('')
      await reload()
      await onReload()
    } finally { setAdding(false) }
  }

  const shown = useMemo(() => entries.filter(e =>
    (filter === 'all' || e.status === filter) && (!q || e.word.includes(q.toLowerCase()))
  ), [entries, filter, q])

  return (
    <div className="max-w-2xl mx-auto px-4 py-4">
      <div className="flex items-center gap-2 mb-3">
        {(['all', 'learning', 'mastered'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-2.5 py-1 rounded-md text-[11px] transition-colors ${filter === f
              ? 'bg-[var(--bg-selected)] text-[var(--text-primary)]'
              : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}`}>
            {{ all: '全部', learning: '学习中', mastered: '已斩' }[f]}
          </button>
        ))}
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

      {shown.length === 0 ? (
        <div className="py-16 text-center text-[12px] text-[var(--text-muted)] leading-relaxed">
          生词本还是空的。<br />
          在任意页面选中英文单词点「翻译」，卡片上点 <Star size={11} className="inline text-[var(--accent)]" /> 即可收藏。
        </div>
      ) : (
        <div className="space-y-1">
          {shown.map(e => (
            <div key={e.word} className="group flex items-center gap-2.5 px-3 py-2 rounded-lg border border-[var(--border-color)] hover:bg-[var(--bg-hover)] transition-colors">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[13px] font-medium text-[var(--text-primary)]">{e.word}</span>
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
              <button onClick={async () => { await wordbookSetMastered(e.word, e.status !== 'mastered'); await reload() }}
                title={e.status === 'mastered' ? '恢复学习' : '斩词：已掌握，移出复习计划'}
                className={`shrink-0 p-1.5 rounded-md opacity-0 group-hover:opacity-100 transition-opacity ${e.status === 'mastered'
                  ? 'text-amber-400 hover:bg-[var(--bg-selected)]'
                  : 'text-[var(--text-muted)] hover:text-amber-400 hover:bg-[var(--bg-selected)]'}`}>
                {e.status === 'mastered' ? <RotateCcw size={12} /> : <Zap size={12} />}
              </button>
              <button onClick={async () => { await wordbookRemove(e.word); await reload(); await onReload() }}
                title="从生词本删除"
                className="shrink-0 p-1.5 rounded-md text-[var(--text-muted)] opacity-0 group-hover:opacity-100 hover:text-red-400 transition-opacity">
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
