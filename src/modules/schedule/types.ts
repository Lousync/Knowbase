export { type ScheduleTodo, type ScheduleTag, type CreateScheduleTodoDTO, type UpdateScheduleTodoDTO } from '../../types'

/**
 * 日程模块的四个视图。
 * - week：日程表（周视图，左「待安排」+ 右 7 天时间网格）
 * - date / deadline / quadrant：既有的三视图（侧栏月历 + 主区卡片列表）
 */
export type ViewMode = 'week' | 'date' | 'deadline' | 'quadrant'
