import { ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { getDatabase, saveToDisk } from '../connection'

// ---- types ----
interface TodoRow {
  id: string; title: string; description: string | null; date: string
  time: string | null; quadrant: number; task_type: string
  tag_id: string | null; status: string; sort_order: number
  end_criteria: string | null
  created_at: string; updated_at: string
}

interface TagRow { id: string; name: string; color: string }

function rowToTodo(row: TodoRow) {
  return {
    id: row.id, title: row.title, description: row.description || '',
    date: row.date, time: row.time || null,
    quadrant: row.quadrant, taskType: row.task_type as 'deadline' | 'plan',
    tagId: row.tag_id, status: row.status as 'pending' | 'done',
    sortOrder: row.sort_order, endCriteria: row.end_criteria || '',
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

// ---- IPC handlers ----
export function registerScheduleHandlers(): void {
  // 按日期获取待办
  ipcMain.handle('schedule:getTodos', (_e, date: string) => {
    const rows = queryAll<TodoRow>(
      'SELECT * FROM schedule_todos WHERE date = ? ORDER BY sort_order, created_at',
      [date]
    )
    return rows.map(rowToTodo)
  })

  // 获取某月有数据的日期列表（日历打点用）
  ipcMain.handle('schedule:getDatesWithTodos', (_e, yearMonth: string) => {
    const rows = queryAll<{ date: string }>(
      "SELECT DISTINCT date FROM schedule_todos WHERE date LIKE ?",
      [`${yearMonth}%`]
    )
    return rows.map(r => r.date)
  })

  // 获取某月全部待办（象限图用）
  ipcMain.handle('schedule:getMonthTodos', (_e, yearMonth: string) => {
    const rows = queryAll<TodoRow>(
      "SELECT * FROM schedule_todos WHERE date LIKE ? ORDER BY date, sort_order, created_at",
      [`${yearMonth}%`]
    )
    return rows.map(rowToTodo)
  })

  // 获取某月截止日期的任务计数（日历数字标记）
  ipcMain.handle('schedule:getDeadlineCounts', (_e, yearMonth: string) => {
    const rows = queryAll<{ time: string }>(
      "SELECT time FROM schedule_todos WHERE task_type = 'deadline' AND time IS NOT NULL"
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
    endCriteria?: string
  }) => {
    const id = randomUUID()
    const now = new Date().toISOString()
    run(
      `INSERT INTO schedule_todos (id,title,description,date,time,quadrant,task_type,tag_id,end_criteria,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [id, data.title, data.description || '', data.date, data.time || null,
        data.quadrant ?? 1, data.taskType || 'plan', data.tagId || null,
        data.endCriteria || '', now, now]
    )
    const rows = queryAll<TodoRow>('SELECT * FROM schedule_todos WHERE id = ?', [id])
    return rowToTodo(rows[0])
  })

  // 更新待办
  ipcMain.handle('schedule:updateTodo', (_e, id: string, data: {
    title?: string; description?: string; date?: string; time?: string | null
    quadrant?: number; taskType?: 'deadline' | 'plan'; tagId?: string | null
    status?: string; endCriteria?: string
  }) => {
    const sets: string[] = ['updated_at = ?']
    const params: unknown[] = [new Date().toISOString()]
    for (const [k, v] of Object.entries(data)) {
      if (v !== undefined) {
        sets.push(`${camelToSnake(k)} = ?`)
        params.push(v)
      }
    }
    params.push(id)
    run(`UPDATE schedule_todos SET ${sets.join(', ')} WHERE id = ?`, params)
    const rows = queryAll<TodoRow>('SELECT * FROM schedule_todos WHERE id = ?', [id])
    return rowToTodo(rows[0])
  })

  // 删除待办
  ipcMain.handle('schedule:deleteTodo', (_e, id: string) => {
    run('DELETE FROM schedule_todos WHERE id = ?', [id])
  })

  // ===== 标签 =====
  ipcMain.handle('schedule:getTags', () => {
    return queryAll<TagRow>('SELECT * FROM schedule_tags ORDER BY name')
  })

  ipcMain.handle('schedule:createTag', (_e, name: string, color?: string) => {
    const id = randomUUID()
    run('INSERT INTO schedule_tags (id, name, color) VALUES (?, ?, ?)', [id, name, color || '#6b7280'])
    const rows = queryAll<TagRow>('SELECT * FROM schedule_tags WHERE id = ?', [id])
    return rows[0]
  })

  ipcMain.handle('schedule:deleteTag', (_e, id: string) => {
    run('DELETE FROM schedule_tags WHERE id = ?', [id])
  })
}

function camelToSnake(s: string): string {
  return s.replace(/[A-Z]/g, c => '_' + c.toLowerCase())
}
