import { ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { recordActivity } from '../../lib/habitLinkService'
import * as V from '../../lib/kbStore/scheduleVaultRepo'

// R6 去库化：真相源 = .knowbase/modules/schedule/*.json（sql.js 路径已移除，D9）

// ---- types ----
interface TodoRow {
  id: string; title: string; description: string | null; date: string
  time: string | null; quadrant: number; task_type: string
  tag_id: string | null; status: string; sort_order: number
  end_criteria: string | null; parent_id: string | null
  created_at: string; updated_at: string
}

function rowToTodo(row: TodoRow) {
  return {
    id: row.id, title: row.title, description: row.description || '',
    date: row.date, time: row.time || null,
    quadrant: row.quadrant, taskType: row.task_type as 'deadline' | 'plan' | 'daily',
    tagId: row.tag_id, status: row.status as 'pending' | 'done',
    sortOrder: row.sort_order, endCriteria: row.end_criteria || '',
    parentId: row.parent_id || null,
    createdAt: row.created_at, updatedAt: row.updated_at
  }
}

// ---- IPC handlers ----
export function registerScheduleHandlers(): void {
  // 按日期获取待办（排除子任务）
  ipcMain.handle('schedule:getTodos', (_e, date: string) => {
    return V.vaultTodosForDate(date).map(rowToTodo)
  })

  // 获取全部逾期未完成的顶层任务（日期早于 today，不限月份；按日期升序）
  // 计划类任务（plan）无截止时间、不逾期，排除在外
  ipcMain.handle('schedule:getOverdue', (_e, today: string) => {
    if (typeof today !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return []
    return V.vaultOverdueTodos(today).map(rowToTodo)
  })

  // 获取某月有数据的日期列表（日历打点用）— 排除子任务
  ipcMain.handle('schedule:getDatesWithTodos', (_e, yearMonth: string) => {
    return V.vaultDatesWithTodos(yearMonth)
  })

  // 获取某月全部待办（象限图用）— 自动清理 7 天前已完成任务 — 排除子任务
  // 附加未完成的计划类任务（plan 无截止日期，跨月常驻显示直到完成）
  ipcMain.handle('schedule:getMonthTodos', (_e, yearMonth: string) => {
    // 清掉 7 天前完成的待办（含子任务）。
    // 清理是尽力而为的维护动作，且写盘失败现在会抛错（writeJsonOrThrow）——
    // 这里必须兜住，否则磁盘异常会连带把「读取当月待办」一起弄挂。
    try {
      V.vaultPurgeStaleDoneTodos()
    } catch (e) {
      console.error('[schedule] 清理过期已完成待办失败：', e)
    }
    return V.vaultMonthTodos(yearMonth).map(rowToTodo)
  })

  // 获取某个父任务的子任务
  ipcMain.handle('schedule:getSubtasks', (_e, parentId: string) => {
    return V.vaultSubtasks(parentId).map(rowToTodo)
  })

  // 获取某月截止日期的任务计数（仅未完成）
  ipcMain.handle('schedule:getDeadlineCounts', (_e, yearMonth: string) => {
    const vaultMap: Record<string, number> = {}
    for (const t of V.vaultPendingDeadlineTimes()) {
      if (!t) continue
      const d = t.slice(0, 10)
      if (d.startsWith(yearMonth)) vaultMap[d] = (vaultMap[d] || 0) + 1
    }
    return vaultMap
  })

  // 创建待办
  ipcMain.handle('schedule:createTodo', (_e, data: {
    title: string; description?: string; date: string; time?: string
    quadrant?: number; taskType?: 'deadline' | 'plan'; tagId?: string
    endCriteria?: string; parentId?: string
  }) => {
    const vId = randomUUID()
    const vNow = new Date().toISOString()
    const row: V.TodoRow = {
      id: vId, title: data.title, description: data.description || '', date: data.date,
      time: data.time || null, quadrant: data.quadrant ?? 1, task_type: data.taskType || 'plan',
      tag_id: data.tagId || null, status: 'pending', sort_order: 0,
      end_criteria: data.endCriteria || '', parent_id: data.parentId || null,
      created_at: vNow, updated_at: vNow
    }
    return rowToTodo(V.vaultCreateTodo(row))
  })

  // 更新待办
  ipcMain.handle('schedule:updateTodo', (e, id: string, data: {
    title?: string; description?: string; date?: string; time?: string | null
    quadrant?: number; taskType?: 'deadline' | 'plan'; tagId?: string | null
    status?: string; endCriteria?: string; parentId?: string | null
  }) => {
    // 联动需要状态跃迁判定:先取旧状态,只有 pending → done 才算"完成"事件
    // (改标题/象限等普通编辑也走本 handler,不能每次都触发)
    const prevStatus = data.status !== undefined ? V.vaultFindTodo(id)?.status : undefined
    const updated = V.vaultUpdateTodo(id, data, new Date().toISOString())
    if (prevStatus !== undefined && prevStatus !== 'done' && data.status === 'done' && updated) {
      void recordActivity({ source: 'schedule', date: updated.date }, e.sender)
    }
    // id 不存在时 vaultUpdateTodo 返回 null 且不改文件
    return rowToTodo(updated!)
  })

  // 删除待办（级联删除子任务）
  ipcMain.handle('schedule:deleteTodo', (_e, id: string) => {
    V.vaultDeleteTodoCascade(id)
  })

  // ===== 标签 =====
  ipcMain.handle('schedule:getTags', () => {
    return V.vaultTagsOrdered()
  })

  ipcMain.handle('schedule:createTag', (_e, name: string, color?: string) => {
    return V.vaultCreateTag({ id: randomUUID(), name, color: color || '#6b7280' })
  })

  ipcMain.handle('schedule:deleteTag', (_e, id: string) => {
    V.vaultDeleteTag(id)
  })
}
