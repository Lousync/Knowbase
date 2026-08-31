# 自动更新优化实现文档（后续迭代）

> 状态：**已实现（2026-08-31）** · 关联代码：`electron/lib/updateService.ts`、`src/lib/updateStore.ts`（新增）、`src/components/shared/TitleBar.tsx`、`src/modules/settings/views/AdvancedView.tsx`、`scripts/publish-release.py`（新增）
> 本文记录自动更新链路的现状问题与后续优化点。下方「〇、实现记录」为落地情况。

---

## 〇、实现记录（2026-08-31）

| 方案 | 落地情况 |
|---|---|
| 3.1 全局状态中枢 | ✅ 新增 `src/lib/updateStore.ts`：`useSyncExternalStore` 单例，check/download/pause/cancel/install 全部走 store 方法，进度事件仅 store 订阅一次；TitleBar 与 AdvancedView 均已接入，两处进度/暂停/取消/失败实时同步 |
| 3.2 失败重试与原因结构化 | ✅ 主进程 `UpdateError` 携带 `reason`（size-mismatch/sha512-mismatch/network/channel-all-failed/cancelled/unknown）+ `step`（download/verify/sha512）；`UpdateResult` 结构化返回；UI 按 reason 分流：integrity 类 →「重新下载」+「更换镜像重试」，network 类 →「重试」+ 镜像引导；`cancelled` 回到 available 不算错误 |
| 3.3 标题栏交互升级 | ✅ available/下载中/暂停/失败 → 点击展开下拉面板（更新说明摘要 MarkdownPreview + 立即下载/暂停/取消/重试/去设置页）；downloaded → 点击直接运行安装；全部状态读 store |
| 3.4 发布脚本完整性门 | ✅ 新增 `scripts/publish-release.py`：门1 三件套齐全性、门2 latest.yml sha512/size 与本地 exe 实测比对、门3 version 一致；通过后 `gh release create/upload` 一次带上三件套，再回读远端资产列表验证；正例 + 三反例（缺 blockmap/sha 不符/版本不符）已测试拦截 |
| 3.5 更新日志展示 | ✅ `checkForUpdate` 本就返回 `notes`（GitHub Release body）；设置页与标题栏面板均以 MarkdownPreview 折叠展示 |
| 3.6 其他 | ✅ 安装包清理：install 成功后在 userData 写标记，下次以新版本启动即删除旧安装包（版本未变=安装失败/取消，保留供重试）；✅ 校验失败带 step 诊断；⬜「每日首次启动提醒」开关未做（P3 可选项，保留 6s 启动延迟不变） |

补充：latest.yml 缺失时下载仍按 size 校验放行，但返回 `metaMissing: true`，两处 UI 均提示「更新源文件不完整」及发布页手动下载指引（对应验收 3）。

---

## 一、现状摘要（2026-08-30 盘点）

**主进程 `updateService.ts` 已具备的能力：**

| 能力 | 说明 |
|---|---|
| 多镜像通道 | GitHub 直连 + 加速代理候选，坏字节自动换下一候选（`mirrorCandidates`） |
| 断点续传 | 单通道下载支持 `Range`，外部中断/换镜像可续传 |
| 大小前置校验 | `content-length` 与期望不符 → 直接判坏字节，不白下整包 |
| SHA512 完整性 | 下载后从 `latest.yml` 取 sha512 校验，不符即判坏字节 |
| 进度广播 | `update:download-progress` 推给所有窗口（percent/receivedBytes/totalBytes） |

**渲染层两处独立 UI：**

| 位置 | 行为 |
|---|---|
| 标题栏（TitleBar） | 启动 6s 后自动检查（失败 10s 间隔重试 3 次后静默）；有更新时显示入口；**无手动触发**、失败无提示 |
| 设置 → 高级（AdvancedView） | 手动检查 / 下载（进度条）/ 暂停 / 取消 / 安装；镜像配置项 |

---

## 二、已确认问题清单

### P1（高优先级，直接影响体验）

1. **下载失败后没有「重新下载/重试」按钮**
   - `AdvancedView` 下载失败仅进入 `error` 态 + 一句错误文案，用户只能重新点「检查更新」走全流程；`TitleBar` 下载失败更隐蔽（进度消失，无提示无重试）
   - 触发场景：服务器文件未传完整（如本次 v2.13.0 先传 exe 后补 blockmap/latest.yml 的窗口期）、镜像坏字节、网络中断
   - 期望：失败态提供「重试」「更换镜像重试」入口，并显示失败原因

2. **标题栏下载进度与设置页不同步**
   - 两处各自维护 `updState / progress` state，互不感知：标题栏开始下载 → 设置页不显示进度；设置页暂停/取消 → 标题栏仍显示旧状态
   - 根因：没有全局唯一的状态中枢，`update:download-progress` 事件被两处各自消费
   - 期望：下载状态/进度/结果全局单源，两处 UI 订阅同一数据源渲染

### P2（中优先级）

3. **失败原因不可读、不可诊断**
   - 下载/校验失败仅返回 `message` 字符串，无结构化原因（`size-mismatch` / `sha512-mismatch` / `network` / `channel-all-failed` / `cancelled` / `paused`）
   - UI 无法区分"镜像坏了换个镜像就行"和"服务器文件没传完"和"纯网络波动"
   - 期望：`UpdateResult` 增加结构化 `reason` 字段；UI 按 reason 展示对应操作（换镜像 / 重试 / 稍后再试）

4. **标题栏更新入口交互弱**
   - `available` 状态时入口行为不明（点一下做什么？）；下载中只有简单百分比；无"去设置页管理"入口
   - 期望：标题栏入口支持 点击展开（下载进度 + 暂停/取消 + 去设置）、下载完成引导安装

5. **无更新日志（Release notes）展示**
   - 检查更新成功后只显示"有新版"，用户不知道更新了什么
   - 期望：拉取 GitHub Release notes 并在设置页/确认弹窗展示

### P3（低优先级）

6. **发布侧无资产完整性自检**（本次事故根因）
   - 本次 v2.13.0 发布时 `latest.yml` / `.blockmap` 未随 exe 一起上传，导致自动更新「integrity check failed」
   - 期望：发布脚本（`scripts/publish-quizbook.py` 同模式的更新发布脚本）增加**三件套完整性门**：exe + `.blockmap` + `latest.yml` 必须同时存在，且 `latest.yml` 内 sha512 与 exe 实测一致，才允许发布

7. **下载完成后缺乏确认/清理**
   - 安装包下载到临时目录，安装成功后无清理；下载完成后无"安装"引导之外的提示
   - 期望：安装完成删除安装包；安装取消/失败保留供重试

8. **检查更新的手动/自动节奏**（低）
   - TitleBar 启动自动检查 3 次后静默，之后无再次自动检查（如应用长时间运行）或手动触发入口
   - 期望：增加"设置页手动检查"（已有）+ 可选"每日首次启动提醒"；避免与启动初始化抢 IO（保留 6s 延迟）

---

## 三、优化方案

### 3.1 全局更新状态中枢（解决 P1-2、P2-4）

**设计**：渲染层单例 `updateStore`（`src/lib/updateStore.ts`）：
- 状态：`{ state: 'idle'|'checking'|'available'|'uptodate'|'downloading'|'paused'|'downloaded'|'error'|'installing', progress: {percent, receivedBytes, totalBytes}, latestVersion?, asset?, reason?, error?, downloadedPath? }`
- 数据源：订阅 `update:download-progress` 事件 + 调用 `checkForUpdate/downloadUpdate/...` 的结果写入 store
- 消费方：TitleBar、AdvancedView 都 `useSyncExternalStore`/context 读 store → 两处天然同步

**要点**：
- 所有更新动作（check/download/pause/cancel/install）统一走 store 的方法，禁止 UI 直接调 IPC 后各自 setState
- 进度事件只由 store 收，UI 只读 store

### 3.2 失败重试与原因结构化（解决 P1-1、P2-3）

- `UpdateResult` 增加 `reason?: 'size-mismatch' | 'sha512-mismatch' | 'network' | 'channel-all-failed' | 'cancelled' | 'paused' | 'unknown'`
- UI 失败态渲染：
  - `sha512-mismatch` / `size-mismatch` → 「下载内容校验失败（服务器文件可能未传完整）」+「重新下载」「更换镜像重试」
  - `network` / `channel-all-failed` → 「网络连接失败」+「重试」+ 镜像配置快捷入口
  - `cancelled` → 回到 available，不视为错误
- 「重新下载」= 重新调 `downloadUpdate`（若 updateService 支持覆盖则先删旧文件）；「更换镜像重试」= 打开镜像选择并重新下载

### 3.3 标题栏交互升级（解决 P2-4）

- `available`：入口显示「v2.13.0 可更新」；点击 → 下拉面板（更新说明摘要 + 「立即下载」+「去设置页」）
- `downloading`：入口显示环形/百分比进度；下拉面板含 暂停/取消/进度条
- `downloaded`：入口「安装并重启」；点击直接 `installUpdate`
- 所有状态从 `updateStore` 读取，与设置页完全一致

### 3.4 发布脚本资产完整性门（解决 P2-6，事故根因）

新建 `scripts/publish-release.py`（或并入现有发布工具）：
- 输入：版本号 + 产物目录
- 门 1：`<Setup>.exe`、`<Setup>.exe.blockmap`、`latest.yml` **三件套必须同时存在**
- 门 2：`latest.yml` 内 `sha512` 与本地 exe 实测 sha256→sha512 编码一致
- 门 3：`latest.yml.version` 与版本号一致
- 通过后：上传三件套到 GitHub Release（`gh release upload` 一次全传），再验证远端资产列表齐全
- 防止本次"exe 先传、yml/blockmap 后补"的窗口期事故

### 3.5 更新日志展示（解决 P2-5）

- `checkForUpdate` 附带拉取 Release notes（`gh` 侧已可用：Release body）；返回 `releaseNotes?`
- 设置页 `available` 态展示「更新内容」折叠区（Markdown 摘要渲染，复用 MarkdownPreview）

### 3.6 其他

- 下载完成后清理：`installUpdate` 成功后删除临时安装包；失败保留
- `updateService` 校验失败时附加诊断：哪一步失败（download → verify → sha512），便于 UI 文案精准
- 可选：设置页增加「每日首次启动提醒」开关（沿用 6s 延迟避免抢 IO）

---

## 四、验收标准

1. 标题栏下载中，打开设置页可见**相同**进度；任一页暂停/取消，另一页立即同步
2. 下载失败（模拟：删除远端 sha512、断网、镜像坏）→ 出现「重试 / 更换镜像」按钮，且文案指明原因类型
3. 服务器文件不完整（缺 latest.yml/blockmap）→ 设置页明确提示"更新源文件不完整"，不出现无意义报错
4. 发布流程：运行 `publish-release.py` 三件套校验拦截后无法发布；补齐后一次成功，Release 资产齐全
5. 更新成功路径：检查 → 下载（两处进度同步）→ 下载完成 → 安装并重启，全程无死胡同

---

## 五、参考：v2.13.0 事故复盘（2026-08-30）

- 现象：自动更新报 `NSIS Error: Installer integrity check has failed`
- 根因：发布时仅上传 exe，`latest.yml`（更新源元数据）与 `.blockmap`（NSIS 完整性校验）缺失/未同步 → 校验失败
- 处置：补传两文件后恢复
- 教训：**发布即三件套原子上传**，后续由 3.4 的发布脚本强制保证
