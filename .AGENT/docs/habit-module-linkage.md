# 习惯打卡跨模块联动方案

> 状态：**已实现**（迁移 048 + `electron/lib/habitLinkService.ts`）。
> 相关模块：习惯打卡（工具箱）、博客、番茄钟、日程、知识库、远程监督。

## 1. 背景与目标

习惯打卡目前是**纯手动勾选**：用户写完日志后，还得回到工具箱再点一次打卡。这把「做了事」和「记录做了事」拆成了两个动作，容易忘、也容易失去动力。

目标是让打卡成为行为的**自然结果**：设定「写日志」习惯并绑定到博客模块后，当天日志写到一定字数即自动打卡，且自动触发远程监督推送。

设计上的核心约束是**和谐**：

- 对现有代码侵入小，不把打卡逻辑散落到各业务模块
- 对用户不打扰，不弹窗打断写作
- 行为可预期：补写能补卡、重复保存不会重复推送、想取消随时能取消

## 2. 现状（实现前的既有事实）

### 2.1 数据模型

`habits`（迁移 038）：`id / name / color / icon / rule_type / rule_days / weekly_target / sort_order / archived`

`habit_records`（迁移 038）：

| 字段 | 说明 |
|------|------|
| `id` | 主键 |
| `habit_id` | 习惯 ID |
| `date` | 打卡日期（本地日期字符串） |
| `created_at` | 写入时间 |
| — | `UNIQUE(habit_id, date)` |

**这个唯一约束是整套方案幂等性的基础**：同一天重复写入不会产生多条记录。

### 2.2 打卡链路

`electron/database/repositories/checkinRepo.ts`：

- `habit:toggleCheck(habitId, date)` —— 存在则删除（取消打卡），不存在则插入
- 插入成功后调用 `notifyCheckin(habitId, date)` 异步推送远程监督，静默失败不影响打卡

### 2.3 各模块可挂载的行为事件

| 模块 | 触发点 | 实际接入位置 |
|------|--------|------|
| 博客 | `db:createEntry` / `db:updateEntry` 成功后 | `electron/database/repositories/entryRepo.ts` |
| 番茄钟 | `pomodoro:createSession` | `electron/database/repositories/summaryRepo.ts`（IPC handler 在主进程，不在渲染层 hook） |
| 日程 | 任务标记完成（`schedule:updateTodo` 内检测 `pending → done` 跃迁） | `electron/database/repositories/scheduleRepo.ts` |
| 知识库 | 新建页面（`knowledge:createPage`） | `electron/database/repositories/knowledgeRepo.ts` |

### 2.4 既有缺陷：`entries.word_count` 恒为 0（已修复）

`word_count` 只在 `db:createEntry` 时写入 `0`，`db:updateEntry` 从不更新它。该字段**不可信**，不能用于字数阈值判定。

已修复：`db:createEntry` / `db:updateEntry` 中同步维护，口径为「去空白后的字符数」：

```ts
const wordCount = (contentMd ?? '').replace(/\s/g, '').length
```

## 3. 设计方案（实现版）

### 3.1 总体思路

> **各模块只上报「发生了行为」（不含指标值），由统一服务在触发时从源表按业务日期反查现值、判定阈值、写入记录。**

不信任事件携带的值、不在联动链路上累积状态，带来四个直接好处：

1. **服务无状态** —— 重启不丢进度
2. **自愈** —— 漏触发的事件（如旧版本数据）下次触发时自动补上；导入备份后自愈
3. **口径统一** —— 四条通路逻辑完全一致，新增联动源只需一处 `computeMetric` 分支 + 一行 `recordActivity`
4. **幂等天然成立** —— 现值是累计量（字数 / 当天场次 / 当天完成数），与 `UNIQUE(habit_id, date)` 的「有记录即达标」语义吻合

```
行为事件(仅 source+date+refId) ──> recordActivity()
                                      │
                            从源表反查现值 computeMetric
                                      │
                                阈值判定
                                      │
                        INSERT OR IGNORE（幂等）+ getRowsModified
                                      │
                          ┌───────────┴───────────┐
                    推送远程监督        habit:autoChecked → 界面轻提示
```

### 3.2 数据模型变更（迁移 048）

```sql
CREATE TABLE IF NOT EXISTS habit_links (
  id         TEXT PRIMARY KEY,
  habit_id   TEXT NOT NULL,
  source     TEXT NOT NULL,   -- blog | pomodoro | schedule | knowledge
  threshold  INTEGER NOT NULL DEFAULT 1,
  enabled    INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hl_habit ON habit_links(habit_id);  -- 一个习惯至多一条规则
CREATE INDEX IF NOT EXISTS idx_hl_lookup ON habit_links(source, enabled);

-- 打卡记录溯源：区分手动与自动，供界面标注与精确撤销
ALTER TABLE habit_records ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
```

> 设计稿原方案有 `metric` 列；实现中删除 —— 源表反查口径下指标由 `source` 唯一确定（blog→字数，pomodoro→场次，schedule→任务数，knowledge→页面数），多存一列只会引入不一致。

规则示例：

| 习惯 | source | threshold 含义 |
|------|--------|--------|
| 写日志 | `blog` | 当天日志去空白字数 |
| 每日专注 | `pomodoro` | 当天专注场次 |
| 整理知识 | `knowledge` | 当天新建页面数 |
| 完成计划 | `schedule` | 当天完成的顶层任务数（`parent_id IS NULL`，父子不重复计数） |

### 3.3 统一服务 `electron/lib/habitLinkService.ts`

```ts
export interface Activity {
  source: 'blog' | 'pomodoro' | 'schedule' | 'knowledge'
  date: string      // 行为发生的业务日期，而非系统当天
  refId?: string    // 来源实体 ID（博文/页面），供精确反查
}

/** 上报一次行为；内部完成源表反查、阈值判定与幂等写入 */
export function recordActivity(activity: Activity, sender?: WebContents): void
```

内部流程：

1. 校验 `source` 白名单与 `date` 格式（`YYYY-MM-DD`），不合法直接放弃
2. 按 `(source, enabled=1, archived=0)` JOIN 出所有绑定规则
3. `computeMetric` 从源表反查现值：
   - `blog`：`SELECT content_md FROM entries WHERE id = refId` → 去空白字符数（与 word_count 维护口径一致）
   - `pomodoro`：`COUNT(*) FROM pomodoro_sessions WHERE date = ?`
   - `schedule`：`COUNT(*) FROM schedule_todos WHERE status='done' AND date=? AND parent_id IS NULL`
   - `knowledge`：`COUNT(*) FROM knowledge_pages WHERE date(created_at, 'localtime') = ?`（created_at 是 UTC ISO 串，必须转本地日期再比）
4. 逐条比对 `value >= threshold`，不满足则跳过
5. 执行 `INSERT OR IGNORE INTO habit_records (id, habit_id, date, source) VALUES (?,?,?, 'auto')`
6. 用 `getRowsModified()` 判断是否**真正插入了新行**；只有新插入才调用 `notifyCheckin(habitId, date)` 并向 `event.sender` 推送 `habit:autoChecked`
7. 全程 try/catch 静默失败 —— 联动是锦上添花，绝不能拖垮业务保存本身

第 6 步是关键：博客是防抖自动保存，若不判断 `getRowsModified()`，每次保存都会给远程监督者推一条消息。

### 3.4 触发点接入（各一行）

`entryRepo.ts` 的 `db:createEntry` / `db:updateEntry` 成功后：

```ts
void recordActivity({ source: 'blog', date: rows[0].date, refId: id }, event.sender)
```

- `updateEntry` 仅在 `contentMd` 或 `date` 有变化时上报（改标签/置顶不触发）
- `schedule:updateTodo` 先读旧 status，只有 **`pending → done` 跃迁**才上报（该 handler 同时承接标题/象限等普通编辑）
- 番茄钟/知识库在各自 INSERT 成功后上报，`date` 用本地日期（知识库创建时间落库为 UTC，反查侧已做 localtime 转换）

### 3.5 IPC 与前端类型

- `habitLink:save(habitId, link | null)` —— 保存/解除绑定（link 为 null 即删除规则）
- `habitLink:remove(habitId)` —— 删除联动配置
- 规则列表**不单独提供通道**：`habit:getAll` 已把 `link` 嵌入每个习惯下发，前端零额外请求
- `Habit` 增加可选字段 `link?: { source, threshold, enabled } | null`；`HabitRecord` 增加 `source?: 'manual' | 'auto'`
- 渲染层 `onHabitAutoChecked(cb)` 订阅 `habit:autoChecked` 事件，收到后弹 toast 并刷新数据

## 4. 关键设计决策

这五条决定方案是否「和谐」，改动前请确认理解其理由。

### 4.1 必须有阈值

博客是**防抖自动保存**。若「保存即打卡」，敲两个字就打上了，习惯会失去意义。

因此字数类指标必须带阈值，默认 **100 字**，用户可在习惯编辑器中调整（步进 50）。计数型指标（番茄场次、任务数、页面数）阈值即当天累计次数（步进 1）。

### 4.2 用业务日期，不用系统当天

`recordActivity` 传入的是**日志自身的 `date`**，不是 `new Date()`。

这样补写昨天的日志，打的是昨天的卡 —— 符合直觉，且让「补卡」成为自然行为而非额外操作。

### 4.3 达标后不自动撤销

用户把内容删回阈值以下时，打卡记录**保留**。

理由：打卡代表「曾经做到过」。自动撤销会让记录反复闪烁，且用户难以理解为什么卡没了。取消的入口始终保留 —— 手动取消任何时候都可用。

### 4.4 不做周期规则检查

习惯设为「每周一三五」但周二写了日志，照样打卡。

理由：现有手动打卡本身就不校验周期（允许任意补卡），自动打卡不应比手动更严格，否则用户会觉得「明明写了却没打上」。

### 4.5 只有新打卡才推送

见 3.3 第 6 步。避免重复骚扰监督者。

## 5. 界面改动（已实现）

| 位置 | 改动 |
|------|------|
| `habit-tracker/components/HabitEditorModal.tsx` | 新增「自动完成」区块：启用开关 + 来源四选一 + 阈值步进（博客步进 50、计数类步进 1）+ 口径说明；保存时随习惯一并写入 `habitLink:save`，关掉开关即解除绑定 |
| `habit-tracker/components/TodayView.tsx` | 习惯卡片名称旁显示联动小徽标（⚡ 写日志 / 番茄专注 / 日程任务 / 知识页面），提示该习惯会自动完成 |
| 打卡圈（日历视图当日明细） | 自动打卡（`source = 'auto'`）用浅一档填充色 + ⚡ 图标 + 「自动」徽标，与手动区分 |
| Toast | 主进程推送 `habit:autoChecked`（仅新打卡时），轻提示「⚡「习惯名」已自动打卡（日期）」并刷新，不弹窗打断 |

## 6. 实施记录

1. **修复 `word_count`** —— `db:createEntry` / `db:updateEntry` 同步维护（独立、无风险）
2. **迁移 048 + `habitLinkService`** —— 打通 `blog / word_count` 通路
3. **接入博客触发点** —— 端到端跑通
4. **扩展其他模块** —— 番茄钟、日程、知识库（源表反查口径下各自仅一行接入；日程含跃迁检测）

## 7. 验证清单

- [ ] 新建日志、字数不足阈值 → 不打卡
- [ ] 字数达到阈值 → 自动打卡，界面出现自动徽章，远程监督收到**一条**推送
- [ ] 继续编辑并保存多次 → 不重复打卡、不重复推送
- [ ] 补写昨天日志并达标 → 打的是昨天的卡
- [ ] 内容删回阈值以下 → 打卡保留，可手动取消
- [ ] `archived = 1` 的习惯 → 不自动打卡
- [ ] 习惯卡片、周月总结、连续天数统计均正确计入自动打卡
- [ ] 日程：仅 `pending → done` 跃迁触发；改标题等普通编辑不触发
- [ ] 导入旧备份包（无 links 字段）→ 正常，联动规则自然跳过

## 8. 风险与边界

- **计数型指标的聚合口径**：已统一为「事件触发时从源表按业务日期反查现值」，见 3.1
- **定时任务的完成事件**：`schedule:updateTodo` 是通用更新通道，已通过「先读旧状态、仅跃迁上报」解决误触发
- **导入导出**：`habit_links` 与 `habit_records.source` 已纳入数据导出/导入；联动规则以 `habitId` 为幂等键
- **回收站**：删除日志进回收站后，对应自动打卡按 4.3 保留；从回收站恢复不影响打卡记录
- **知识库跨天边界**：`created_at` 落库为 UTC ISO 串，反查使用 `date(created_at, 'localtime')` 对齐本地业务日期

## 9. 后续扩展

- 反向联动：连续打卡 N 天后，自动生成一篇阶段性总结博客
- 条件组合：支持多条规则「任一满足 / 全部满足」
- 与 AI 助手打通：由 AI 在周总结中分析各习惯的自动完成率
