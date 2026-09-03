# 外部修改检测与冲突解决机制设计

> 状态：v1（保存时 mtime 校验）已落地 · v2（实时监听）待排期
> 适用：编辑器模块（Vault 仓库文件编辑）

## 一、背景与问题

「仓库即工作区」模型下，仓库根目录的内容文件（知识库 .md、博客等）可能同时被其他软件修改——VS Code、Typora、git 恢复、文件管理器等。此前编辑器模块是「打开时读快照」模式：

| 场景 | 改造前行为 | 风险 |
|---|---|---|
| 外部改文件，本地已打开且未编辑 | 无感知，显示旧内容 | 信息过期 |
| 外部改文件，本地有未保存修改 | 无感知，Ctrl+S **无提示覆盖磁盘新内容** | **静默丢数据（最危险）** |
| 外部删除/重命名 | 无感知，保存时报错 | 报错无上下文 |

## 二、VS Code 机制借鉴分析

VS Code 的冲突处理是**两层**结构（非单一机制）：

### 第一层：保存时 mtime 校验（防数据丢失的最后防线）

`TextFileEditorModel` 保存时比对磁盘 mtime 与上次读/写记录的基线，不一致即抛 `FILE_MODIFIED_SINCE`，触发冲突通知。配套：

- 通知按钮：**Compare**（打开 diff 对比）/ **Overwrite**（直接覆盖磁盘）
- 设置项 `files.saveConflictResolution`（VS Code 1.42 引入）：
  - `"askUser"`（默认）：拒绝保存，询问用户
  - `"overwriteFileOnDisk"`：总是覆盖磁盘（设置描述明确警告可能丢数据）

**这层不需要 watcher，纯 mtime 比对即可挡住"静默覆盖"**——投入产出比最高。

### 第二层：FileSystemWatcher 实时事件（体验层）

官方 Wiki（File Watcher Internals）揭示的实现细节：

| 维度 | VS Code 做法 |
|---|---|
| 递归监听 | ParcelWatcher（Rust 实现），非递归用 `fs.watch` |
| 运行位置 | watcher 托管到独立 **UtilityProcess**（计算密集，避免阻塞主进程） |
| 自身写入误报 | **不靠标记**：靠 mtime/内容幂等比对——自己写完后 mtime 即最新，事件回来内容一致视为无变化 |
| 排除规则 | `files.watcherExclude`（默认排除 `.git/objects`、`node_modules`） |
| 失效降级 | 路径不存在/被删 → watcher suspend；复用已有递归 watcher 或降级为 `fs.watchFile` 轮询（5s） |
| 句柄耗尽 | `onDidWatchFail` → 提示用户 |
| 性能折叠 | 删除文件夹只报顶层目录事件 |

> 误区澄清：VS Code 的 **event correlation**（`createWatcher()`，事件带 correlationId）是给扩展监听用的性能优化，并非用于区分"自身写入 vs 外部修改"；且 2024-09 起因 parcel-watcher 不稳定被禁用（官方 Wiki 注明 "assume that all watching is uncorrelated"）。

### 三种场景的标准行为

| 场景 | VS Code 行为 |
|---|---|
| 外部改 + 本地干净 | **静默重载**（保留光标位置），undo 栈清空 |
| 外部改 + 本地脏 | 通知三选：Compare / Overwrite / Revert |
| 外部删除 | 通知：Close / Save as |

## 三、Knowbase 落地设计

### 总体架构

```
外部软件写盘 → 文件系统
                ├── 路径 A：保存时 mtime 校验（v1，零依赖）→ 冲突 → 用户三选
                └── 路径 B：chokidar 实时监听（v2）→ clean 自动重载 / dirty 冲突横幅
```

### 检测层（主进程 workspaceManager）

- 打开文件时记录磁盘基线 `{ mtimeMs, size }`（`ws:readFile` 返回 `mtimeMs`）
- 保存时渲染层把基线传回（`ws:writeFile` 新增 `expectedMtimeMs` 参数）：
  - 主进程写盘前 `statSync` 比对，mtime 偏差 > 2ms 判冲突（容差应对文件系统精度）
  - 冲突 → 拒绝写入，回报 `{ conflict: true, diskMtimeMs, diskSize, missing }`
  - 文件已不存在 → `missing: true`
  - 未传基线 → 直接放行（兼容旧调用）

### 判定与决策（渲染层 editor 模块）

- 文档模型 `EditorDoc` 新增 `mtimeMs` 字段（基线随读/写刷新）
- 冲突弹窗三选（对标 VS Code askUser）：
  1. **重新加载**：放弃本地修改，重新 `ws:readFile` 取磁盘内容（内容/基线/脏标记一并刷新）
  2. **覆盖磁盘**：以磁盘最新 mtime 为基线强制写回（保留本地修改）
  3. **暂不处理**：关闭弹窗继续编辑
- 文件被删除：弹窗提示「文件已在磁盘上被删除」，同样三选（覆盖磁盘会重新创建文件）

### IPC 契约

| 通道 | 变更 |
|---|---|
| `ws:readFile` | 响应新增 `mtimeMs`（磁盘 mtime 基线） |
| `ws:writeFile` | 请求新增可选 `expectedMtimeMs`；冲突时响应 `{ ok:false, conflict:true, diskMtimeMs, diskSize, missing }` |

## 四、v1 落地记录（已完成）

- `electron/lib/workspaceManager.ts`：
  - 新增纯函数 `detectConflict(absPath, expectedMtimeMs): ConflictCheck`（可单测）
  - `readWorkspaceFile` 返回 `mtimeMs`
  - `ws:writeFile` 支持冲突检测，冲突即拒绝写入
- `src/modules/editor/`：
  - `EditorDoc.mtimeMs` 基线；打开/保存/重载时刷新
  - `saveDoc(relPath, forceMtimeMs?)`：`forceMtimeMs` 用于覆盖磁盘路径
  - 冲突弹窗（三选按钮）+ `reloadFromDisk` / `overwriteDisk` 处理函数
- 桥接：preload / types（`WorkspaceReadResult.mtimeMs`、`WorkspaceWriteResult`）/ ipc.ts 同步

### 验证

- `tmp/smoke/workspace-smoke.mjs` 新增 7 条断言，**43/43 全绿**：
  - mtime 一致 → 无冲突；外部修改 → 冲突且回报磁盘 mtime
  - 文件删除 → conflict + missing；未传基线 → 放行
  - 写回后新基线 → 无冲突（覆盖磁盘路径闭环）
- tsc 双侧新代码零错误；`npm run build` 通过

## 五、v2 / v3 展望

### v2：实时监听（chokidar，对标 VS Code 完整体验）

- 主进程 chokidar 监听授权根，`ignored` 排除 `.git / node_modules / out / dist` 等
- 事件去抖（同路径 500ms 合并）；自身写入靠 mtime 幂等比对自然忽略
- 主进程 → 渲染层事件推送（沿用 `onDataChanged` 的 send 模式）
- 渲染层：clean → 自动重载；dirty → 冲突横幅；外部删除 → 提示 + 保留内存副本；目录树增量刷新
- 设置项：`workspace.saveConflictResolution`（ask / overwrite）、实时监听开关（大仓库可关）

### v3：增强

- diff 对比视图（对标 VS Code Compare 按钮）
- watcher 迁移到 Electron `utilityProcess`（独立进程，避免主进程 CPU 占用）
- watcher 句柄耗尽降级提示；符号链接事件策略

## 六、已知边界

- `.knowbase/` 应用数据暂未接实时监听（其重载语义归 kbStore 层处理，去库化 P5+ 再定）
- 多实例同仓库双开：待确认是否已有 Electron 单实例锁；若无，双开操作同一仓库是数据灾难，应补单例锁
- 渲染层当前只有「保存时」冲突路径；「打开后外部改但未保存」的主动感知依赖 v2 的 watcher
