import { useCallback, useMemo } from 'react'
import { useSettings } from '../../../lib/SettingsContext'
import { LESSON_TOTAL } from './lessons'

/**
 * AI 学堂 · 上手路径进度（落盘于 settings.learnProgress，json 型字符串）
 *
 * 约定：`{ done: number[], last: number }`
 *   done —— 已标记完成的步骤序号；last —— 上次停留的步骤（下次打开直接回到这里）
 * 读取一律 try/catch 兜底：settings 里的值可能被手工改坏或用旧版本遗留。
 */

export interface LearnProgress {
  done: number[]
  last: number
}

/** hook 返回值（供 AiLearnShell 等消费方标注类型） */
export interface LearnProgressApi {
  done: number[]
  last: number
  total: number
  setLast: (n: number) => void
  markDone: (n: number) => void
  reset: () => void
}

const EMPTY: LearnProgress = { done: [], last: 1 }

function parse(raw: unknown): LearnProgress {
  try {
    const o = JSON.parse(String(raw ?? '')) as Partial<LearnProgress>
    const done = Array.isArray(o?.done)
      ? [...new Set(o.done.filter((n): n is number => Number.isInteger(n) && n >= 1 && n <= LESSON_TOTAL))].sort((a, b) => a - b)
      : []
    const n = Number(o?.last)
    const last = Number.isInteger(n) ? Math.min(Math.max(n, 1), LESSON_TOTAL) : 1
    return { done, last }
  } catch {
    return EMPTY
  }
}

export function useLearnProgress(): LearnProgressApi {
  const { s, update } = useSettings()

  const state = useMemo(() => parse(s.learnProgress), [s.learnProgress])

  const save = useCallback((next: LearnProgress) => {
    update('learnProgress', JSON.stringify(next))
  }, [update])

  /** 切换当前步骤（只动 last，不动 done） */
  const setLast = useCallback((n: number) => {
    if (n === state.last) return
    save({ ...state, last: n })
  }, [save, state])

  /** 标记完成；顺带把 last 推到下一步，形成「学完自然往下走」的节奏 */
  const markDone = useCallback((n: number) => {
    const done = state.done.includes(n) ? state.done : [...state.done, n].sort((a, b) => a - b)
    const last = n < LESSON_TOTAL ? n + 1 : n
    save({ done, last })
  }, [save, state])

  const reset = useCallback(() => save(EMPTY), [save])

  return {
    done: state.done,
    last: state.last,
    total: LESSON_TOTAL,
    setLast,
    markDone,
    reset,
  }
}

/**
 * 把当前步骤拼成提问上下文（AgentContextInfo），随提问附带给主进程。
 * 复用 lib/assistantContext 的既有通道 —— 主进程侧无需任何新增逻辑，
 * buildSystemPrompt 会把它拼进【当前上下文】段（见 agentService.ts:218）。
 */
export function learnStepContext(lesson: { n: number; title: string; goal: string }, total = LESSON_TOTAL, docBody?: string) {
  return {
    type: 'learnStep',
    label: `AI 学堂 · 第 ${lesson.n} 步：${lesson.title}`,
    data: {
      stepNo: lesson.n,
      totalSteps: total,
      stepTitle: lesson.title,
      stepGoal: lesson.goal,
      说明: '用户正在 AI 学堂的上手路径里学习。回答请围绕当前这一步展开，不要越步讲后面的内容，除非用户明确追问。',
      ...(docBody ? { 关联手册片段: docBody.slice(0, 4000) } : {}),
    },
  }
}
