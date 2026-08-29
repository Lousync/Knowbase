# 开发者工具演进路线（Dev Bridge Roadmap）

> 状态：**规划稿**。基于已实现的 AI 测试桥（见 `docs/ai-test-bridge.md`）。
> 六项创意全部生长在既有骨架（动作注册表、环形缓冲、selftest 注册、HTTP 路由）之上，不推翻任何东西，不改动既有业务逻辑。

## 1. 现状：已建成的两层

| 层级 | 能力 | 载体 |
|------|------|------|
| L1 可观测 | health / state / db / logs / errors / net / ipc | `electron/devbridge/server.ts` |
| L2 可断言 | 15 个动作 + selftest 8 项 + 可外部注册 | `actions/` + `selftest.ts` |

本路线图规划 L3–L5 三层共六项能力，核心主题一句话：**让回归网自己生长，而不只靠 AI 想到才写**。

## 2. 设计原则（沿用）

- 仅 DEV：全部挂在 `__DEV_BRIDGE__` 之后，生产构建零残留
- 低侵入：不改动既有业务逻辑文件；新增能力全部在 `electron/devbridge/` 内
- 可断言：沿用统一响应结构与错误码
- 破坏性动作必须显式 `confirm`，且只作用于 dev 数据目录

## 3. L3 可学习

### 3.1 数据库 Diff（P0，预估半天）

**目标**：AI 改代码前拍快照、改后拍快照，验证「预期的写入发生了、意外的写入为零」。

**接口草案**：

| 端点 | 说明 |
|------|------|
| `POST /db/snapshot` | 对当前内存库 `db.export()` 存快照，返回 `{ id, sizeBytes, tables }` |
| `GET /db/snapshots` | 快照列表 |
| `DELETE /db/snapshot/:id` | 删除 |
| `GET /db/diff?from=<id>&to=<id>` | 表级 + 行级差异 |

**实现要点**：

- 快照即 `Uint8Array`，用 `new SQL.Database(bytes)` 惰性加载做对比
- 行级 diff：从 `PRAGMA table_info` 取主键，按主键对齐后输出 `added / removed / changed`；大字段（`content_md` 等）只比对哈希不输出原文
- 快照上限 5 份（内存库约几十 MB 一份），超出淘汰最旧
- 输出结构面向 AI：`{ table, pk, kind: 'added'|'removed'|'changed', fields: string[] }`

**验收**：改一行博客正文 → diff 应只出现 `entries` 一行 `changed` 且字段为 `content_md / word_count / updated_at`。

### 3.2 回归录制器（P1，预估 2–3 天）

**目标**：人工正常使用应用的过程自动变成回归资产——「用过就有」，而非「AI 想到才写」。

**设计**：工具负责**录制与重放**，断言生成交给 AI。三者闭环：

```
录制（用户正常使用）→ 轨迹 JSON → AI 阅读并生成 selftest → 常驻回归网
```

**接口草案**：

| 端点 | 说明 |
|------|------|
| `POST /record/start` | 开始录制，之后的 action 调用与 IPC 写通道被记入轨迹 |
| `POST /record/stop` | 结束，返回 `{ traceId }` |
| `GET /record/trace/:id` | 轨迹：动作序列 + 每步前后的表级行数/关键行快照 |
| `POST /record/replay/:id` | 按序重放（仅白名单动作），逐步比对数据面 |

**实现要点**：

- 轨迹记录复用 `ipcRing` 思路，但只记**写通道**（`create*/update*/delete*`）与 action 调用，读通道不录
- 每步附带 diff（复用 3.1 的快照对比），AI 拿到的是「动作 → 数据变化」的因果对
- 重放前自动 `data.reset` + 重放 `data.seed` 场景，保证起点一致；`data.reset` 本身不参与录制
- 断言生成是 AI 的活：`GET /record/trace/:id` 的输出就是给 LLM 的上下文

**验收**：录制「创建习惯 → 写日志 → 自动打卡」一段使用，AI 依据轨迹产出 `flow.habitAutoCheckin` 断言并注册，`/selftest` 可复跑。

## 4. L4 可破坏

> 项目最引以为傲的全是恢复机制——原子写盘、`.bak` 回退、迁移事务、Zip Slip 防护、备份导入预检——但没有一条被真正测试过。本层是唯一能验证它们的方法。

### 4.1 混沌注入（P0，预估 1–2 天）

**关键约束**：`.bak` 回退、迁移中断这类场景需要**重启应用**才能验证，而应用死亡后 HTTP 桥也随之消失。因此拆成「注入（桥内）+ 验证（脚本）」两半：

- 桥内动作负责**准备灾难现场**
- `scripts/chaos-verify.cjs` 负责 spawn → 注入 → kill → 重启 → 断言恢复结果（沿用 ui-walk-verify 的 CDP 骨架）

**接口草案（桥内）**：

| 动作 | 说明 |
|------|------|
| `chaos.corruptMainDb` | 将 `knowledge.db` 前几 KB 覆盖为随机字节（原件另存） |
| `chaos.corruptBak` | 破坏 `.bak`，验证双损坏路径的降级行为 |
| `chaos.malformedBackupZip` | 生成畸形备份包（坏 entry 名 / 假 `export.json` / 超深路径）到临时目录 |
| `chaos.halfMigratedDb` | 从空库跑迁移到第 N 条后**不提交**导出，模拟中断库形态 |

**脚本验证项**：

- [ ] 主库损坏 → 自动从 `.bak` 恢复，损坏现场留存为 `.corrupt-*`
- [ ] 主库 + `.bak` 双损坏 → 全新库创建，不崩溃死循环
- [ ] 畸形备份包导入 → 被预检拒绝且给出可读错误，原数据无损
- [ ] 中断库启动 → 迁移事务保证无「半条迁移」标记，应用可正常打开

### 4.2 兼容探针（P2，预估 1–2 天）

**目标**：49 个迁移意味着老用户的库可能是任何历史形态；防止「新代码只在最新库上测试」的盲区。

**接口草案**：

| 端点 | 说明 |
|------|------|
| `GET /compat/versions` | 列出迁移链与对应历史版本号（迁移文件即原料） |
| `POST /compat/build` | `{ until: '023_moments_image' }` → 新建内存库跑 `MIGRATIONS.slice(0, n)`，切换当前 db 指向它 |
| `POST /compat/restore` | 恢复为正常库 |

**实现要点**：迁移已拆为独立文件，`MIGRATIONS.slice(0, n)` 直接可用；历史数据形态由 AI 按需用现有 action 灌入。测试完务必 `restore`，否则后续请求全部落在旧库上。

### 4.3 Monkey 测试（P2，预估 1 天）

**接口草案**：`POST /monkey/run` body `{ rounds: 200, exclude?: string[] }`。

**实现要点**：

- 从动作注册表随机选动作、按参数类型注入模糊值：空串、负数、超大数、超长字符串、特殊字符（emoji / SQL 片段 / 路径分隔符）、错误类型
- 每轮后自检两项：进程存活、`/errors` 无新增 error 级日志
- 默认排除 `data.reset`（破坏性）；`chaos.*` 全排
- 返回 `{ rounds, errors: [...], slowest: [...] }`

**验收**：200 轮零崩溃、零未捕获异常；发现的边界问题转化为正式断言。

## 5. L5 可进化

### 5.1 需求↔断言追溯（P2，预估半天）

**目标**：让回归网有地图——「v2.11.0 的 7 个功能点，5 个有断言保护、2 个裸奔」。

**设计**：`registerCheck` 增加可选元信息：

```ts
registerCheck('flow.habitAutoCheckin', fn, { req: 'habit-linkage' })
```

**接口**：`GET /coverage` 返回 `{ features: [{ req, checks: string[], covered: boolean }], uncovered: string[] }`。需求清单由 AI 在实现功能注册断言时同步维护；devtools 面板（后续）可视化覆盖率。

### 5.2 AI 体检报告（P1，预估半天）

**目标**：一条命令产出喂给 LLM 的标准开场上下文，AI 每次对话自带「应用当前状态」。

**接口**：`GET /report`，聚合输出（面向 LLM 的紧凑结构，参考 `builtinTools` 的输出风格）：

- selftest 结果（失败项置顶）
- errors Top 5（按计数）
- 慢 IPC Top 10（`durationMs > 100`）
- schema 概要（表数、行数 Top 10、最近迁移）
- 最近网络错误

控制在 ~2KB 内，保证塞进任何模型上下文都不心疼。

## 6. 实施顺序

| 顺序 | 项目 | 成本 | 理由 |
|------|------|------|------|
| 1 | 数据库 Diff | 半天 | 立刻服务当前迭代（打卡联动 / word_count 验证） |
| 2 | 混沌注入 + 验证脚本 | 1–2 天 | 保护最不容有失的数据安全机制 |
| 3 | AI 体检报告 | 半天 | 成本极低，每次 AI 会话都受益 |
| 4 | 回归录制器 | 2–3 天 | 长期价值最大，但依赖录制 UI |
| 5 | Monkey 测试 | 1 天 | 边界兜底 |
| 6 | 兼容探针 / 需求追溯 | 各 0.5–2 天 | 生态完善项 |

## 7. 风险与边界

- **快照内存**：内存库 export 一份约几十 MB，快照上限 5 份并淘汰最旧；`/db/diff` 大表只输出哈希差异
- **混沌动作必须可恢复**：每个 `chaos.*` 动作要么自带还原，要么在文档中明确「需重启自愈」；绝不提供「无解的破坏」
- **Monkey 排除破坏性动作**：`data.reset`、`chaos.*` 不参与随机
- **兼容探针用后必还原**：`/compat/build` 切换 db 指向后，忘记 restore 会让后续测试全部落在旧库——在响应里显著提示
- **录制器隐私**：轨迹可能包含用户输入的日志正文；仅 dev 数据目录，不出本机，但导出轨迹给 AI 时应提示

## 8. 待决事项

1. 快照存内存还是落盘（`userData/devbridge-snapshots/`）？→ 推荐落盘，避免 devbridge 自己把内存吃爆
2. 回归录制器的 UI 放哪：devtools 面板（可视化）还是纯 curl（无 UI）？→ 推荐先纯 curl，验证闭环后再补面板
3. 需求清单的维护方式：手动注册还是从 CHANGELOG 解析？→ 推荐手动注册（解析 CHANGELOG 过度设计）
