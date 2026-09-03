# 单仓库与账户模型设计

> 归属：[rework-master-plan.md](./rework-master-plan.md) D2 / R0-R3 阶段。状态：设计定稿，未实现。

## 1. 模型

- **单仓库**：一个应用实例同一时刻只挂一个 Vault。首次启动（无 currentVaultId）走全屏引导（WelcomeOverlay 已有雏形）选择/新建目录，之后每次启动自动恢复
- **仓库 = 账户**：user_profile 与仓库绑定；「切换账户」= 从最近仓库列表选另一个目录 = 整套数据上下文切换
- 与 Obsidian 差异：Obsidian 有多仓库切换器但账户概念弱；我们把账户身份落到仓库，天然支持「工作仓/个人仓」隔离

## 2. 上下文切换语义

```
currentVault（内存态，主进程持有）
  ├─ vaultContext.setCurrentVault(vaultId)   ← 唯一切换入口
  ├─ 所有 ws:* / kbStore 读写都经 currentVault 解析根路径
  └─ settings.json currentVaultId 持久化（合并写回，已修复双写冲突）
切换动作 = flush 未保存状态 → 清空内存索引缓存（knowledgeIndex/GraphIndex 各仓库已按仓库隔离）
        → setCurrentVault → 通知渲染层全量刷新 → 状态栏更新
```

- 切换不需要重启进程，但必须**清空所有 per-vault 内存态**（索引缓存、打开的文档、AI 上下文）
- 打开的编辑器文档在切换时：脏文档弹确认（保存到旧仓库/放弃），清空标签页

## 3. 首次引导流程

1. 无 currentVaultId → WelcomeOverlay 全屏：新建仓库（选目录 → 写 `.knowbase/meta.json`）| 打开已有仓库 | 最近列表
2. 选定后 → ensureKbRoot（已实现）→ 迁移检测：若该 userData 有旧 SQLite 数据且目标仓库为空 → 提示运行迁移器（`migrate-to-vault.mjs` / 产品化后的 vaultMigration）
3. 跳过引导进入空仓库（合法状态：Obsidian 同款空 Vault）

## 4. 账户级数据的落位（对接去库化 P1-P4）

- user_profile 从 SQLite 移到 `.knowbase/profile.json`（R3 期随 userRepo 迁移）
- 各模块 `modules/*.json` 已在 kbStore 规划内（jsonStore/mdStore/secretStore）
- 插件安装状态、AI 会话历史：目前全局，R3 期迁 `.knowbase/`（会话跟随账户）

## 5. 设备级数据（留 userData）

最近仓库列表（`userData/recentVaults.json`：id/name/path/lastOpened）、主题布局、锁屏密码、DPAPI 密钥。**path 只存主进程侧**，渲染层仍只见 vaultId。

## 6. 边界情况

| 场景 | 处理 |
|---|---|
| 仓库目录被外部删除/移动 | 启动 loadVaults 检测 path 不存在 → 标记失效 → 引导重新选择，不静默清 currentVaultId |
| 同一目录被两个实例打开 | 单实例锁（待确认项）；锁定失败提示「仓库已在另一窗口打开」 |
| 仓库拷贝到新机器 | DPAPI 密文（密码本/AI Key）不可解 → 检测解密失败 → 引导「重新加密」流程（开放问题 O3） |
| 锁屏 | 锁的是「应用 + 当前仓库」；切账户前必须解锁（O2 语义） |
| 当前仓库内新建/删除文件（外部程序改动） | v1 依赖写时失效；v2 watcher（chokidar）统一感知 |

## 7. 验收清单

- [ ] 首次启动引导 → 建仓 → 默认进入 → 重启自动恢复
- [ ] 切换账户：数据上下文完整切换，索引缓存不串仓
- [ ] 最近仓库列表跨重启持久，渲染层无绝对路径泄漏
- [ ] 脏文档切仓有确认弹窗，无静默丢失
- [ ] 旧 SQLite 数据迁移入口出现在「目标仓库为空 + 检测到旧库」场景
