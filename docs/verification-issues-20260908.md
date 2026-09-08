# 验收问题归集 2026-09-08

> 背景：`.ignore` 过滤层验收期间（test 仓库）暴露。以下问题均已实锤定位，修复另开会话。

## 1. V-7 复测实锤：HMR 更新共享组件引爆 Monaco dispose 循环（P1）

**现象**（dev 日志 10:37-10:40 连环刷屏）：
- `Error: InstantiationService has been disposed`（PaneErrorBoundary 兜底）
- Monaco 无限循环：`Cannot read properties of undefined (reading 'setClassName' / 'domNode' / 'getWidgets')`、`Error: Model is disposed!`

**触发链**：dev 下另一会话 HMR 更新共享组件（`ResizablePanel.tsx` + `styles/index.css`，10:37:19 / 10:39:26 两次）→ 组件树重挂 → 旧 Monaco 实例 dispose，但 `EditorRenderingCoordinator` 渲染协调器仍持有引用 → 渲染帧循环抛错。

**连带危害（本次 .ignore 验收被误判的直接原因）**：
- 知识库模块 IPC 拉数据失败 → 列表停留在 renderer 内存旧数据 → 表现为「.ignore 过滤不生效」（主进程缓存实际已正确过滤：目标目录页面 0 条）
- 编辑器文件树「删除（回收站）」请求发不到主进程 → 表现为「删不掉」（主进程日志无任何 ws:trash 调用/报错）

**修复方向**：MonacoPane 卸载时先解除渲染协调器对旧 view/model 的引用再 dispose（或 try/catch 吞掉 disposed 后的渲染帧错误）；HMR 边界考虑对 editor 模块失效重载（vite import.meta.hot dispose 兜底）。属挂账 V-7（monaco 0.56 dispose 复测）的实锤复现场景。

**临时自救**：窗口内 Ctrl+R 刷新 renderer 即可恢复，无需重启 dev。

## 2. devbridge 测试脚本选择器错误（P3，非产品 bug）

`tmp/eval-req.json`（devbridge ui.eval 请求记录）中探测脚本 `document.querySelector("div[class*=w-0.5]")`——属性选择器值含 `.` 未加引号 → SyntaxError 刷日志。产品代码无此问题。脚本侧应写 `div[class*="w-0.5"]`。

## 3. .ignore 相关（本会话已修/挂账，汇总备查）

- 已修：外部改 `.ignore` 缓存不感知（`getVaultIgnoreState` 指纹对账，commit 待提交）
- 已修：`.ignore` 主进程归档守卫 + 专属图标（设计文档 §9，待落码）
- P4 挂账：规则未命中磁盘条目进 warnings；分类认领空白归一化宽松匹配（§10.2 space 退化）
- 运维注意：本机 dev 启动必须带 `KNOWBASE_DISABLE_GPU=1`，否则 GPU 进程崩溃退出；`out/` 目录 EPERM 时 `mv out out_prev_*` 绕过（多会话并行期 mv 可能被占用进程拒绝，先清进程）
