import { ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { getDatabase, saveToDisk } from '../connection'
import { isVaultDataSource } from '../dataSourceMode'
import { buildUpdateSet } from '../../lib/safeUpdate'
import { recordActivity } from '../../lib/habitLinkService'
import * as V from '../../lib/kbStore/scheduleVaultRepo'

/**
 * 日程：待办（schedule_todos）+ 标签（schedule_tags）。
 * 去库化 P2：storageData=vault 时读写 .knowbase/modules/schedule/{todos,tags}.json，
 * 任一 handler 首次访问即把 sqlite 存量整表播种到 json（之后以 json 为权威源）；
 * sqlite 路径原样保留，两源走同一个 rowToTodo/TagRow，返回 DTO 逐字段一致。
 */

// ---- types ----
interface TodoRow {
  id: string; title: string; description: string | null; date: string
  time: string | null; quadrant: number; task_type: string
  tag_id: string | null; status: string; sort_order: number
  end_criteria: string | null; parent_id: string | null
  created_at: string; updated_at: string
}

interface TagRow { id: string; name: string; color: string }

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

// ---- helpers ----
function queryAll<T>(sql: string, params: unknown[] = []): T[] {
  const db = getDatabase()
  const stmt = db.prepare(sql)
  if (params.length > 0) stmt.bind(params)
  const rows: T[] = []
  while (stmt.step()) rows.push(stmt.getAsObject() as T)
  stmt.free()
  return rows
}

function run(sql: string, params: unknown[] = []): void {
  getDatabase().run(sql, params)
  saveToDisk()
}

/**
 * 首次进入 vault 模式：整表搬运 sqlite 存量到 json（幂等，todos.json 已存在即跳过）。
 * 表缺失 / 库不可用 → 按空表播种（等价于「新仓库从空开始」，不阻断读写）。
 */
export function ensureScheduleVaultSeeded(): void {
  if (!isVaultDataSource()) return
  if (V.vaultScheduleExists()) return
  let todos: TodoRow[] = []
  let tags: TagRow[] = []
  try { todos = queryAll<TodoRow>('SELECT * FROM schedule_todos') } catch { todos = [] }
  try { tags = queryAll<TagRow>('SELECT * FROM schedule_tags') } catch { tags = [] }
  V.vaultTodosSave(todos)
  V.vaultTagsSave(tags)
}

// ---- IPC handlers ----
export function registerScheduleHandlers(): void {
  // 按日期获取待办（排除子任务）
  ipcMain.handle('schedule:getTodos', (_e, date: string) => {
    if (isVaultDataSource()) {
      ensureScheduleVaultSeeded()
      return V.vaultTodosForDate(date).map(rowToTodo)
    }
    // 当日任务 + 未完成的计划类任务（plan 无截止日期，常驻显示直到完成）
    const rows = queryAll<TodoRow>(
      "SELECT * FROM schedule_todos WHERE parent_id IS NULL AND (date = ? OR (task_type = 'plan' AND status = 'pending')) ORDER BY sort_order, created_at",
      [date]
    )
    return rows.map(rowToTodo)
  })

  // 获取全部逾期未完成的顶层任务（日期早于 today，不限月份；按日期升序）
  // 计划类任务（plan）无截止时间、不逾期，排除在外
  ipcMain.handle('schedule:getOverdue', (_e, today: string) => {
    if (typeof today !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return []
    if (isVaultDataSource()) {
      ensureScheduleVaultSeeded()
      return V.vaultOverdueTodos(today).map(rowToTodo)
    }
    const rows = queryAll<TodoRow>(
      "SELECT * FROM schedule_todos WHERE date < ? AND status = 'pending' AND parent_id IS NULL AND task_type != 'plan' ORDER BY date, sort_order, created_at",
      [today]
    )
    return rows.map(rowToTodo)
  })

  // 获取某月有数据的日期列表（日历打点用）— 排除子任务
  ipcMain.handle('schedule:getDatesWithTodos', (_e, yearMonth: string) => {
    if (isVaultDataSource()) {
      ensureScheduleVaultSeeded()
      return V.vaultDatesWithTodos(yearMonth)
    }
    const rows = queryAll<{ date: string }>(
      "SELECT DISTINCT date FROM schedule_todos WHERE date LIKE ? AND parent_id IS NULL",
      [`${yearMonth}%`]
    )
    return rows.map(r => r.date)
  })

  // 获取某月全部待办（象限图用）— 自动清理 7 天前已完成任务 — 排除子任务
  // 附加未完成的计划类任务（plan 无截止日期，跨月常驻显示直到完成）
  ipcMain.handle('schedule:getMonthTodos', (_e, yearMonth: string) => {
    if (isVaultDataSource()) {
      ensureScheduleVaultSeeded()
      // 与 sqlite 首句 DELETE 同语义：清掉 7 天前完成的待办（含子任务）
      V.vaultPurgeStaleDoneTodos()
      return V.vaultMonthTodos(yearMonth).map(rowToTodo)
    }
    run("DELETE FROM schedule_todos WHERE status = 'done' AND updated_at < datetime('now', '-7 days')")
    const rows = queryAll<TodoRow>(
      "SELECT * FROM schedule_todos WHERE parent_id IS NULL AND (date LIKE ? OR (task_type = 'plan' AND status = 'pending')) ORDER BY date, sort_order, created_at",
      [`${yearMonth}%`]
    )
    return rows.map(rowToTodo)
  })

  // 获取某个父任务的子任务
  ipcMain.handle('schedule:getSubtasks', (_e, parentId: string) => {
    if (isVaultDataSource()) {
      ensureScheduleVaultSeeded()
      return V.vaultSubtasks(parentId).map(rowToTodo)
    }
    const rows = queryAll<TodoRow>(
      'SELECT * FROM schedule_todos WHERE parent_id = ? ORDER BY sort_order, created_at',
      [parentId]
    )
    return rows.map(rowToTodo)
  })

  // 获取某月截止日期的任务计数（仅未完成）
  ipcMain.handle('schedule:getDeadlineCounts', (_e, yearMonth: string) => {
    if (isVaultDataSource()) {
      ensureScheduleVaultSeeded()
      // 同下 sqlite 查询 + `if (!r.time) continue`：deadline + pending + time 非空，再按日期段计数
      const vaultMap: Record<string, number> = {}
      for (const t of V.vaultPendingDeadlineTimes()) {
        if (!t) continue
        const d = t.slice(0, 10)
        if (d.startsWith(yearMonth)) vaultMap[d] = (vaultMap[d] || 0) + 1
      }
      return vaultMap
    }
    const rows = queryAll<{ time: string }>(
      "SELECT time FROM schedule_todos WHERE task_type = 'deadline' AND status = 'pending' AND time IS NOT NULL"
    )
    // time field stores "YYYY-MM-DD HH:MM" for deadlines; count per date in this month
    const map: Record<string, number> = {}
    for (const r of rows) {
      if (!r.time) continue
      const d = r.time.slice(0, 10)  // extract YYYY-MM-DD
      if (d.startsWith(yearMonth)) {
        map[d] = (map[d] || 0) + 1
      }
    }
    return map
  })

  // 创建待办
  ipcMain.handle('schedule:createTodo', (_e, data: {
    title: string; description?: string; date: string; time?: string
    quadrant?: number; taskType?: 'deadline' | 'plan'; tagId?: string
    endCriteria?: string; parentId?: string
  }) => {
    if (isVaultDataSource()) {
      ensureScheduleVaultSeeded()
      // 默认值与下面 sqlite INSERT 逐项一致：status/sort_order 走表列默认（'pending'/0），
      // 时间戳沿用 handler 现有的 new Date().toISOString() 格式
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
    }
    const id = randomUUID()
    const now = new Date().toISOString()
    run(
      `INSERT INTO schedule_todos (id,title,description,date,time,quadrant,task_type,tag_id,end_criteria,parent_id,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, data.title, data.description || '', data.date, data.time || null,
        data.quadrant ?? 1, data.taskType || 'plan', data.tagId || null,
        data.endCriteria || '', data.parentId || null, now, now]
    )
    const rows = queryAll<TodoRow>('SELECT * FROM schedule_todos WHERE id = ?', [id])
    return rowToTodo(rows[0])
  })

  // 更新待办
  ipcMain.handle('schedule:updateTodo', (e, id: string, data: {
    title?: string; description?: string; date?: string; time?: string | null
    quadrant?: number; taskType?: 'deadline' | 'plan'; tagId?: string | null
    status?: string; endCriteria?: string; parentId?: string | null
  }) => {
    if (isVaultDataSource()) {
      ensureScheduleVaultSeeded()
      const prevStatus = data.status !== undefined ? V.vaultFindTodo(id)?.status : undefined
      const updated = V.vaultUpdateTodo(id, data, new Date().toISOString())
      if (prevStatus !== undefined && prevStatus !== 'done' && data.status === 'done' && updated) {
        void recordActivity({ source: 'schedule', date: updated.date }, e.sender)
      }
      // id 不存在时与 sqlite 路径同样落到 rowToTodo(undefined)（UPDATE 影响 0 行，不改文件）
      return rowToTodo(updated!)
    }
    // 联动需要状态跃迁判定:先取旧状态,只有 pending → done 才算"完成"事件
    // (改标题/象限等普通编辑也走本 handler,不能每次都触发)
    const prevStatus = data.status !== undefined
      ? queryAll<{ status: string }>('SELECT status FROM schedule_todos WHERE id = ?', [id])[0]?.status
      : undefined
    // 列名白名单:渲染层传入的 key 不直接拼 SQL(防注入)
    const { sets, params } = buildUpdateSet(
      data,
      ['title', 'description', 'date', 'time', 'quadrant', 'task_type', 'tag_id', 'status', 'end_criteria', 'parent_id'],
      { sets: ['updated_at = ?'], params: [new Date().toISOString()] }
    )
    params.push(id)
    run(`UPDATE schedule_todos SET ${sets.join(', ')} WHERE id = ?`, params)
    const rows = queryAll<TodoRow>('SELECT * FROM schedule_todos WHERE id = ?', [id])

    if (prevStatus !== undefined && prevStatus !== 'done' && data.status === 'done' && rows.length > 0) {
      void recordActivity({ source: 'schedule', date: rows[0].date }, e.sender)
    }
    return rowToTodo(rows[0])
  })

  // 删除待办（级联删除子任务）
  ipcMain.handle('schedule:deleteTodo', (_e, id: string) => {
    if (isVaultDataSource()) {
      ensureScheduleVaultSeeded()
      V.vaultDeleteTodoCascade(id)
      return
    }
    run('DELETE FROM schedule_todos WHERE parent_id = ?', [id])
    run('DELETE FROM schedule_todos WHERE id = ?', [id])
  })

  // ===== 标签 =====
  ipcMain.handle('schedule:getTags', () => {
    if (isVaultDataSource()) {
      ensureScheduleVaultSeeded()
      return V.vaultTagsOrdered()
    }
    return queryAll<TagRow>('SELECT * FROM schedule_tags ORDER BY name')
  })

  ipcMain.handle('schedule:createTag', (_e, name: string, color?: string) => {
    if (isVaultDataSource()) {
      ensureScheduleVaultSeeded()
      return V.vaultCreateTag({ id: randomUUID(), name, color: color || '#6b7280' })
    }
    const id = randomUUID()
    run('INSERT INTO schedule_tags (id, name, color) VALUES (?, ?, ?)', [id, name, color || '#6b7280'])
    const rows = queryAll<TagRow>('SELECT * FROM schedule_tags WHERE id = ?', [id])
    return rows[0]
  })

  ipcMain.handle('schedule:deleteTag', (_e, id: string) => {
    if (isVaultDataSource()) {
      ensureScheduleVaultSeeded()
      V.vaultDeleteTag(id)
      return
    }
    run('DELETE FROM schedule_tags WHERE id = ?', [id])
  })
}

function camelToSnake(s: string): string {
  return s.replace(/[A-Z]/g, c => '_' + c.toLowerCase())
}
