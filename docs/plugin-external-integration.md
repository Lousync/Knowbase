# 外部软件联动插件：候选目标调研

> 归属：[rework-master-plan.md](./rework-master-plan.md) D3 / R7。状态：调研完成（2026-09-02），目标清单待用户圈定后出设计。
> 调研方式：公开 API 文档核实（2026-09-02 WebSearch）。纯本地定位不变——所有云端联动默认**拉取式**，不暴露本地服务。

## 1. 候选目标盘点（已核实开放接口）

| 软件 | 类别 | API | 鉴权 | 关键能力 | 局限 |
|---|---|---|---|---|---|
| **Anki**（桌面+AnkiConnect 插件） | 记忆/学习卡片 | **AnkiConnect 本地 HTTP** `127.0.0.1:8765`（v6） | 无（可选 apiKey） | addNotes 批量制卡、findNotes/notesInfo、deck 管理、复习统计 | 需 Anki 本体运行；本地协议 |
| **滴答清单 TickTick / Dida365** | 任务+习惯+番茄 | **官方 Open API** OAuth2，`api.ticktick.com`；国内版 **`api.dida365.com`** | OAuth2（client_id/secret、tasks:read/write） | 项目/任务 CRUD、完成、日期重复 | 习惯/番茄数据**不在** Open API 范围，只到任务层 |
| **Habitica** | 习惯游戏化 RPG | API v3（REST 全量：habits/dailys/todos/rewards）+ **webhook 推送** | x-api-user + x-api-key | 任务评分、属性、webhook 事件（完成→他方触发） | 游戏化玩法重；webhook 需公网回调地址（本地应用不可用） |
| **Readwise / Reader** | 阅读高亮沉淀 | 官方 API：v2 高亮导出 + v3 文档管理（含 save） | Token（设置页自取） | 高亮/笔记按书导出、Reader 文档库 CRUD、50 req/min | 付费订阅制；token 即密码需加密存 |

其他未入选：Forest/潮汐等专注类**无开放 API**；Notion/飞书有开放 API 但定位冲突（Notion 本身也是知识库，双向同步语义复杂，暂不列为 v1 目标）；Obsidian 无 API 但 Vault 文件直读 = 我们已在做的事，无需桥。

## 2. 四个候选的联动场景（按契合度排序）

### S1 Anki 联动（学习闭环，**最契合纯本地理念**）
- **错题本 → 卡片**：408 错题/quiz 错题一键转 Anki 卡片（addNotes 批量），deck 按「知识库空间/分类」映射
- **知识页 → 卡片**：编辑器选中文本 → 「制卡」命令（后续 v2 的选中→引用机制可直接复用）
- 反向：Anki 复习数据（cardsInfo 到期/迟滞）回显在错题本统计
- 契合点：AnkiConnect 是 127.0.0.1 本地协议——**零 OAuth、零云依赖、数据不出本机**，与 Knowbase 安全模型完全同构；试点时连 kb.net 能力都不需要，只走新增「本地回环 HTTP」授权

### S2 滴答清单（任务回流）
- 知识库页/任务 ↔ 滴答任务：在 Knowbase 建的知识页可「发送为滴答任务」（含链接回原文）；滴答到期任务回流显示
- 注意：滴答的**习惯/番茄不开放**——联动只到任务层；国内用户必须走 Dida365 端点（api.dida365.com）

### S3 Habitica（打卡游戏化）
- 习惯打卡完成 → Habitica 对应 daily/habit 评分（POST score/up）
- webhook 方向**不可行**（需要公网回调，本地应用收不到）→ 只做 Knowbase→Habitica 单向推送 + 周期拉取状态

### S4 Readwise（阅读高亮 → 知识页）
- 读书高亮（Kindle/网页/PDF）增量拉取 → 自动生成知识页（frontmatter + 引用来源），承接「知识库=阅读沉淀」主线
- v1 只做「高亮→知识页」单向增量；双向（知识页高亮回写）留后

## 3. 对网关的启示（v3 能力面修正）

联动插件暴露了 `kb.net.restricted`（白名单 POST，为远程监督设计）**不够用**的事实：

| 缺口 | 场景 | 需要 |
|---|---|---|
| OAuth2 全流程 | TickTick / Habitica / Readwise 都要 | **宿主级 Connector 框架**：OAuth 授权（浏览器开窗回环回调）、token 刷新、DPAPI 加密存 token（secretStore 现有）、按账户隔离（随仓库走 or 设备级，待定） |
| 本地回环 HTTP | AnkiConnect 127.0.0.1:8765 | 新增 `kb.net.localhost`（仅 127.0.0.1 + 用户配置端口 + 可选 apiKey）——低危，可先行 |
| 定时同步 | 所有云端联动（拉取） | 宿主定时唤醒/调度（与番茄钟/打卡插件化的前置同一块能力） |
| 轮询替代 webhook | Habitica 等推送不可达 | 统一按「周期拉取 + 手动刷新」设计，不要做入站服务 |

**架构结论**：联动类插件 = **宿主内置 Connector 框架 + 每个目标一个适配器插件**（connector 提供 OAuth/token/调度，适配器提供目标 API 语义），类比 WorkBuddy 自身的 Connector 体系，但 Knowbase 侧由宿主主进程实现（渲染层/插件只见经过授权的结果）。这个框架放 R7，Anki 联动因零 OAuth 可提前到 R7 的 V3-3/3-4 试点窗口。

## 4. 待拍板

1. **目标清单**：实际每天在用的软件？（决定第一个适配器做谁）
2. Anki 若是目标：是否接受「联动需 Anki 桌面运行」这一前提？（替代：导入 .apkg 离线包——但丢实时性）
3. OAuth Connector 框架的账户归属：token 跟仓库（账户）还是跟设备？（Readwise/TickTick 账号是个人级，倾向设备级 + 关联当前仓库）
4. 云端联动与「纯本地」卖点的平衡：默认全手动同步按钮 + 可选自动定时，是否可接受
