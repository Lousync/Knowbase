# AI 测试桥（Dev Bridge）

> 状态：**已实现并实测通过**。仅开发/测试环境启用，生产构建完全不打包。
> 目标：让 AI 无需人工点击界面即可自动化验证功能。

## 1. 它解决什么问题

本项目为纯 vibecoding 项目，代码主要由 AI 编写。改动后的验证存在三个瓶颈：

| 瓶颈 | 影响 |
|------|------|
| 每次验证需冷启动应用（CDP 方式） | 单次反馈 15–30 秒 |
| 只能看到 console error | 看不到数据库、设置、UI 状态，相当于盲改 |
| 无法构造业务数据 | 空库下「周月总结」「习惯统计」等功能无法验证 |

测试桥在应用内起一个本地 HTTP 服务，AI 用 `curl` 即可观测与驱动，**可连接正在运行的实例**，配合 HMR 做到秒级反馈。

与现有 `scripts/ui-walk-verify.cjs`（CDP 冷启动全量遍历）是**互补关系**：日常迭代用桥，发版前跑 CDP 脚本做完整验收。

## 2. 快速开始

```bash
npm run dev
```

`scripts/launch.js` 在 dev 模式下自动注入 `KNOWBASE_DEV_BRIDGE=1`，启动后终端打印：

```
[AI-BRIDGE] http://127.0.0.1:7465   (dev only, 生产构建不包含本模块)
```

随后即可：

```bash
curl -s localhost:7465/health | jq
curl -s localhost:7465/selftest | jq '.data.failed'
```

### 开关控制

| 场景 | 方式 |
|------|------|
| dev 默认开启 | `npm run dev`（launch.js 自动注入） |
| dev 临时关闭 | `KNOWBASE_DEV_BRIDGE=0 npm run dev` |
| 生产构建 | 不设该变量即完全不打包 |
| 自定义端口 | `KNOWBASE_DEV_BRIDGE_PORT=7500`（默认 7465，占用时自动顺延） |

## 3. 接口

所有端点返回统一结构（满足可断言要求）：

```jsonc
// 成功
{ "ok": true,  "ts": "2026-08-29T02:20:28.197Z", "durationMs": 1, "data": { } }

// 失败
{ "ok": false, "ts": "...", "durationMs": 1,
  "error": { "code": "E_SQL_READONLY", "message": "仅允许 SELECT / PRAGMA / EXPLAIN", "detail": { } } }
```

HTTP 状态码只表示「接口是否可达」；业务成败一律看 body 的 `ok` 与 `error.code`。

### 3.1 错误码

| code | 含义 | HTTP |
|------|------|------|
| `E_NOT_FOUND` | 未知端点或资源 | 404 |
| `E_BAD_REQUEST` | 参数缺失、JSON 解析失败、未知表名 | 400 |
| `E_SQL_READONLY` | 违反只读约束 | 500 |
| `E_SQL_ERROR` | SQL 执行失败 | 500 |
| `E_ACTION_UNKNOWN` | 未注册的动作名 | 500 |
| `E_ACTION_FAILED` | 动作执行失败 | 500 |
| `E_NEED_CONFIRM` | 危险操作缺少 `confirm: true` | 500 |
| `E_DISABLED` | 非本机访问 | 403 |
| `E_INTERNAL` | 其他异常 | 500 |

### 3.2 观测类

| 端点 | 说明 |
|------|------|
| `GET /` | 端点清单 + 动作清单 + 自检清单，AI 调用一次即可自举 |
| `GET /health` | 版本、`isPackaged`、数据库路径、运行时长 |
| `GET /state` | 窗口尺寸与焦点、当前激活模块、表数、设置摘要 |
| `GET /db/schema` | 全部表名与行数 |
| `POST /db/query` | 只读 SQL，body `{ sql, params?, maxRows? }`，自动追加 LIMIT |
| `GET /logs` | 日志，query `since` / `limit` / `level` / `scope` |
| `GET /errors` | 聚合后的报错（去重计数），query `warn=1` 含警告 |
| `GET /net` | 网络请求：url、method、status、durationMs、size |
| `GET /ipc` | IPC 调用：通道、耗时、成败 |

```bash
curl -sX POST localhost:7465/db/query -d '{"sql":"SELECT count(*) AS c FROM entries"}'
# {"ok":true,"data":{"rows":[{"c":4}],"rowCount":1,"truncated":false}}
```

**只读约束**：仅放行 `SELECT` / `PRAGMA` / `EXPLAIN`，且先剥离注释再判定，`/* c */ DELETE ...` 这类绕过同样被拒。

### 3.3 操作类

统一走 `POST /action`，body `{ name, params }`。

| 动作 | 参数 | 说明 |
|------|------|------|
| `data.reset` | `{ confirm: true, tables? }` | 清空业务表，**必须显式 confirm** |
| `data.seed` | `{ scenario, days? }` | `blog30d` / `habits` / `knowledge` / `full` |
| `auth.hasPassword` | — | 是否设置锁屏密码 |
| `auth.unlock` | `{ password }` | 模拟解锁 |
| `auth.setPassword` | `{ password }` | 设置密码 |
| `auth.clearPassword` | `{ password }` | 清除密码（需原密码正确） |
| `blog.create` | `{ date, title?, contentMd?, tags? }` | 同日期已存在则直接返回 |
| `blog.update` | `{ id, title?, contentMd? }` | 同步更新 word_count |
| `habit.create` | `{ name }` | — |
| `habit.check` | `{ habitId, date? }` | 幂等，仅新打卡才推送 |
| `habit.uncheck` | `{ habitId, date? }` | — |
| `schedule.createTodo` | `{ title, date?, quadrant? }` | — |
| `schedule.completeTodo` | `{ id }` | — |
| `pomodoro.complete` | `{ minutes }` | 落一条专注记录 |
| `knowledge.createPage` | `{ title, contentMd?, categoryId? }` | — |

```bash
curl -sX POST localhost:7465/action -H 'content-type: application/json' \
  -d '{"name":"data.seed","params":{"scenario":"blog30d","days":10}}'
# {"ok":true,"data":{"name":"data.seed","result":{"scenario":"blog30d","days":10,"detail":{"entries":9}}}}
```

**打卡幂等实测**：第一次返回 `{"checked":true,"notified":true}`，第二次 `{"checked":false,"alreadyChecked":true,"notified":false}` —— 重复保存不会重复推送远程监督。

### 3.4 自检

`GET /selftest`（`?only=<name>` 可跑单项）。内置 8 项：

`db.openable`、`db.tableCount`、`db.migrationCount`、`db.readOnlyEnforced`、`logs.noErrors`、`flow.blogRoundTrip`、`flow.habitCheckIdempotent`、`cleanup.noSelftestResidue`

表数与迁移数按「**不少于基线**」判定（当前基线 33 表 / 47 迁移），新增表属正常演进，表丢失才算回归。CSP 字体告警等良性噪声已排除。

支持外部注册，供 AI 每实现新功能时补一条断言：

```ts
import { registerCheck } from './selftest'
registerCheck('my.feature', () => ({ name: 'my.feature', ok: someCondition }))
```

## 4. 实现结构

```
electron/devbridge/
├── index.ts          # 入口：installCapture（同步）+ startBridge（异步）
├── server.ts         # HTTP 服务与路由
├── response.ts       # 统一响应与错误码
├── ring.ts           # 环形缓冲（日志/网络/IPC 共用，支持 since 增量拉取）
├── db.ts             # 只读查询与 schema
├── capture.ts        # net.fetch / fetch / ipcMain.handle / console 包装
├── selftest.ts       # 自检项与可扩展注册
└── actions/          # data / auth / flows 三类动作

src/devbridge/
└── collector.ts      # 渲染层 console / error / rejection 收集上报
```

**接入点共 3 处**，均不改动既有业务逻辑：

1. `electron.vite.config.ts` — main 加 `define: { __DEV_BRIDGE__ }`
2. `electron/main/index.ts` — `initDatabase()` 后、`registerXxxHandlers()` 前启动
3. `electron/preload/index.ts` — 追加 `devbridgeApi.report`

```ts
// electron/main/index.ts
if (__DEV_BRIDGE__ && !app.isPackaged) {
  const bridge = await import('../devbridge')
  bridge.installCapture()                    // 同步，必须早于 handler 注册
  void bridge.startBridge({ getMainWindow: () => mainWindow, ... })
}
```

> 拆成两步是为了满足时序约束：`installIpcCapture` 通过包装 `ipcMain.handle` 记录调用，**必须早于各 Repository 注册 handler**，否则一个通道都覆盖不到；HTTP 服务则异步启动、不阻塞应用启动。

## 5. 环境隔离与安全

| 措施 | 实现 |
|------|------|
| 构建期消除 | `define.__DEV_BRIDGE__` 为 false 时，动态 import 的 chunk 被 tree-shake，产物中不生成 |
| 运行期守卫 | `app.isPackaged` 二次校验 |
| 仅本机 | 监听 `127.0.0.1`，并校验 `remoteAddress`，非回环返回 403 |
| SQL 只读 | 剥离注释后判定首关键字，自动追加 LIMIT |
| 动作白名单 | 只执行注册表内的名字，不接受任意代码或任意 SQL |
| 危险操作确认 | `data.reset` 必须 `confirm: true` |
| 脱敏 | URL 去掉 query 与 hash；请求头只记 content-type；不读 body |
| 端口顺延 | 占用时自动 +1，最多尝试 10 次 |

> 网络记录**不读 body**：Response 流只能消费一次，读取会破坏原有业务逻辑。

### 生产构建零残留（实测）

```bash
env -u KNOWBASE_DEV_BRIDGE npm run build
```

| 检查项 | 关闭时 |
|--------|--------|
| `out/main/chunks/` 目录 | 不存在（开启时存在且含特征串） |
| 主进程 `AI-BRIDGE` / `7465` / `/selftest` | 全 0 |
| 渲染层 `installRendererCollector` / `devbridgeApi` | 全 0 |
| 对照 `registerCheckinHandlers` | 存在（证明 grep 与构建均正常） |

## 6. 自测步骤

```bash
# 1. 启动
npm run dev

# 2. 观测
curl -s localhost:7465/health | jq
curl -s localhost:7465/db/schema | jq '.data.tableCount'

# 3. 自检（8 项应全过）
curl -s localhost:7465/selftest | jq '{passed:.data.passed, total:.data.total, failed:.data.failed}'

# 4. 造数据并验证
curl -sX POST localhost:7465/action -H 'content-type: application/json' \
  -d '{"name":"data.seed","params":{"scenario":"full","days":30}}' | jq '.ok'
curl -sX POST localhost:7465/db/query -d '{"sql":"SELECT count(*) AS c FROM entries"}' | jq

# 5. 只读约束
curl -sX POST localhost:7465/db/query -d '{"sql":"DELETE FROM entries"}' | jq '.error.code'
# 期望 "E_SQL_READONLY"

# 6. 幂等
# habit.check 连调两次，第二次应为 alreadyChecked:true、notified:false

# 7. 生产零残留
env -u KNOWBASE_DEV_BRIDGE npm run build && ls out/main/   # 不应有 chunks/
```

## 7. 已知限制

- **IPC 追踪覆盖不到** `initDatabase()` 之前注册的 handler。当前启动点已尽量提前，但 `app.whenReady()` 前注册的通道不在记录范围内。
- **dev 数据目录**：dev 模式数据落在 `%APPDATA%/knowbase (dev)`，与正式数据隔离；但直接以 `electron.exe out/main/index.js` 方式启动时，目录名会退化为 `Electron (dev main)`，属预期行为。
- **无 GPU 环境**：CI 或容器中启动需加 `--disable-gpu`，否则 Chromium GPU 进程崩溃会拖垮整个应用。注意参数须放在应用路径之后：`electron.exe out/main/index.js --disable-gpu`。
- **动作层独立实现**：`blog.create` 等动作未复用既有 Repository（其逻辑内联在 IPC handler 中、无可导出纯函数），而是按相同表结构与约束独立实现。代价是少量逻辑重复，收益是不改动任何既有业务文件。

## 8. 后续方向

- **演进路线**：见 `docs/devbridge-roadmap.md` —— 数据库 Diff、回归录制器、混沌注入、兼容探针、Monkey 测试、需求追溯、AI 体检报告，全部生长在本文档的骨架之上
- 在 `src/modules/devtools/` 的 `TOOLS` 中追加可视化面板（日志流、自检结果、动作触发）
- 将高频能力包装为 MCP Server tools，让支持 MCP 的 AI 客户端直接调用（项目已有完整 MCP client 实现）
- 补 `schedule` / `knowledge` 侧的更多动作，覆盖双链解析与知识包导入
