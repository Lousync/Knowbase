import { useCallback, useEffect, useRef, useState } from 'react'
import { onAgentStep, onAgentStream } from '../../../lib/ipc'
import type { AgentStreamEvent, AgentTraceStep } from '../../../types'

/**
 * 流式过程状态（docs/ai-streaming-design.md §5.3.1）。
 *
 * 设计要点：
 * - **草稿独立于 messages 数组**：流式内容放这里，避免每个 delta 触发消息列表全量 diff
 * - **节流**：delta 只 mutate ref，60ms 才 setState 一次（主进程侧另已 40ms 合批）
 * - 用 setTimeout 而非 rAF：本项目是多 Tab display:none 常驻保活架构，rAF 在窗口不可见时会挂起
 */

export type ProcessItem =
  | { kind: 'narr'; key: string; text: string }
  | {
      kind: 'tool'; key: string; name: string; label: string; target?: string
      state: 'running' | 'done' | 'fail'; durationMs?: number
    }

export interface StreamDraft {
  thinking: string
  text: string
  items: ProcessItem[]
  /** performance.now() 起点，供计时显示 */
  startedAt: number
  round: number
}

const FLUSH_MS = 60
/** 思考链只保留尾部（滚动展示用），避免长思考把内存与渲染成本拉高 */
const MAX_THINKING = 4000

/** 增量的纯应用逻辑：主进程事件 → 草稿（保持无副作用，便于排查） */
function applyStreamEvent(d: StreamDraft, e: AgentStreamEvent): void {
  if (e.kind === 'round-start') {
    d.round = e.round
    return
  }
  if (e.kind === 'thinking') {
    d.thinking = (d.thinking + e.delta).slice(-MAX_THINKING)
    return
  }
  if (e.kind === 'text') {
    d.text += e.delta
    return
  }
  // 工具开始：本轮已有正文 → 那是模型动工具前说的话，降级为「过程旁白」挪进时间线
  // （这样中间轮文本自动变成旁白，最终轮正文留在 d.text 作为回答本体，无需额外协议）
  if (d.text.trim()) {
    d.items.push({ kind: 'narr', key: `n${d.items.length}`, text: d.text.trim() })
    d.text = ''
  }
  d.items.push({
    kind: 'tool', key: `t${d.items.length}`, name: e.name,
    label: e.label, target: e.target, state: 'running',
  })
}

/** agent:step 的工具完成事件 → 与「最近一个同名 running」配对原地转 ✓ / ✕ */
function completeTool(d: StreamDraft, step: AgentTraceStep): void {
  for (let i = d.items.length - 1; i >= 0; i--) {
    const it = d.items[i]
    if (it.kind === 'tool' && it.state === 'running' && it.name === step.name) {
      d.items[i] = { ...it, state: step.ok ? 'done' : 'fail', durationMs: step.durationMs }
      return
    }
  }
}

export function useAgentStream(chatIdRef: { current: string }): {
  draft: StreamDraft | null
  liveSteps: AgentTraceStep[]
  begin: () => void
  end: () => void
} {
  const draftRef = useRef<StreamDraft | null>(null)
  const liveRef = useRef<AgentTraceStep[]>([])
  const timerRef = useRef<number | null>(null)
  const [, setTick] = useState(0)

  const flushSoon = useCallback(() => {
    if (timerRef.current !== null) return
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      setTick(t => (t + 1) % 1_000_000)
    }, FLUSH_MS)
  }, [])

  useEffect(() => {
    const offStream = onAgentStream(({ chatId, event }) => {
      if (chatId !== chatIdRef.current) return
      const d = draftRef.current
      if (!d) return
      applyStreamEvent(d, event)
      flushSoon()
    })
    const offStep = onAgentStep(({ chatId, step }) => {
      if (chatId !== chatIdRef.current) return
      liveRef.current = [...liveRef.current.slice(-19), step]
      const d = draftRef.current
      // durationMs=0 的是 visual.html 的「生成中」占位事件，不参与完成配对
      if (d && step.kind === 'tool' && step.durationMs > 0) completeTool(d, step)
      flushSoon()
    })
    return () => { offStream(); offStep() }
  }, [chatIdRef, flushSoon])

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
  }, [])

  const begin = useCallback(() => {
    if (timerRef.current !== null) { window.clearTimeout(timerRef.current); timerRef.current = null }
    draftRef.current = { thinking: '', text: '', items: [], startedAt: Date.now(), round: 0 }
    liveRef.current = []
    setTick(t => (t + 1) % 1_000_000)
  }, [])

  const end = useCallback(() => {
    if (timerRef.current !== null) { window.clearTimeout(timerRef.current); timerRef.current = null }
    draftRef.current = null
    liveRef.current = []
    setTick(t => (t + 1) % 1_000_000)
  }, [])

  return { draft: draftRef.current, liveSteps: liveRef.current, begin, end }
}
