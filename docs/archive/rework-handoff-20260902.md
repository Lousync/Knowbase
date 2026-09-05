# Knowbase 重构会话交接摘要（2026-09-02 讨论会话 → 实现会话）

> **[2026-09-03 归档]** 一次性交接文档，接收方（实现会话）已推进至 R4，使命完成，移入 `docs/archive/` 历史留存。当前状态以 `docs/rework-master-plan.md` 为准。

## 给下一个会话的话

这份摘要来自 2026-09-02 11:43-13:06 的**纯讨论会话**（只出方案/原型/文档，未写实现代码）。你接手时：
- 本机另有实现会话在 **fix/optimize-v2.15.1** 分支工作（大量未提交改动），先 `git status` 再动手
- 完整细节以 docs/ 下 8 份设计文档为准，本文只给骨架与决策
- 沙箱坑（git commit ref 回滚、safe-delete 拦截删除、build 清 out 失败）绕法见用户级长期记忆

## 一、总方向（已拍板）

目标：把 Knowbase 重构为 **Obsidian 内核 + VS Code 外壳**：
- **数据层**：Vault 文件即数据，.knowbase/ 存模块数据，彻底去 sql.js（P0-P5 已并入统一路线图）
- **索引层**：metadataCache（knowledgeIndex ✅ + GraphIndex 待做）落 `.knowbase/cache/`
- **外壳层**：Workbench 化（活动栏/侧栏视图/编辑器组/底部面板/状态栏）+ 命令面板 + 快速切换

拍板清单：① 单仓库=账户（切账户=换目录）② 插件尽可能开放（沙箱 iframe/Worker + capability 网关 + 市场签名；红线从「不执行代码」改「执行但关沙箱」）③ Workbench 化做 ④ d3-force 引入 ⑤ 图谱放知识库模块、标签默认入图带开关 ⑥ 读写分工：知识库=阅读器，编辑器=交互式写入 UI（Vault 写入两条受控通道=编辑器 + AI 文件工具，同守卫链）⑦ 文档总-分引用制。

## 二、统一路线图（总方案 §5）

R0 数据地基 **✅ 已由另一会话收官**（vault 读层 knowledgeVaultRepo、storageKnowledge 双读源开关、26 通道分流、编辑器跳转闭环、importRepo vault 拦截；冒烟 35+29+43+13 全绿）
→ **下一步 R1 Workbench 骨架**（最大单点，建议单独一轮）→ R2 编辑器与链接（双链/全局搜索/分屏）→ R3 数据层推广（P1-P4）→ R4 图谱 G0-G4 → R5 Live Preview CM6 → R6 删库收尾（最后）→ R7 插件开放+工具箱插件化

## 三、文档索引（都在 E:\Projects\KnowledgeRecorder\docs\）

| 文档 | 状态 | 要点 |
|---|---|---|
| rework-master-plan.md | 总方案定稿 | D1-D8 拍板记录、三层架构、数据边界表、R0-R7、子文档索引、O1-O4 |
| rework-workbench-design.md | 设计定稿 | 五区布局、模块→侧栏映射表、App.tsx 改造面、灰度开关 `ui.workbench`、W1-W3 |
| rework-vault-account-model.md | 设计定稿 | 单仓库=账户、切换语义、首次引导、验收清单 |
| rework-plugin-openness.md | 方向定稿 | **基线修正**：pluginRegistry 已支持 type:'ui'+capabilities(≤10)+grantedCapabilities——v3 是扩展非从零；缺 kb.vault/kb.store/kb.net 命名空间、签名、Worker 通道 |
| graph-view-design.md | 定稿 | Obsidian 逆向（d3-force+Worker+idle 冷却）；GraphIndex 数据源（.knowbase/cache/graph.json，复用 4 失效钩子）；引擎宿主化；G0-G4 |
| rework-toolbox-as-plugins.md | 定稿 | **现状核查**：强密码生成器已转市场插件（工具箱现行 10 工具）；待搬=体重/网址，⚠️习惯+远程监督(合并)/番茄钟，❌密码本/导出/lanShare；新能力：kb.ui.statusbar/kb.notify/kb.net.restricted/kb.ui.filePicker |
| plugin-pdf-reader-design.md | 设计定稿 | 方案 A（编辑器组文档类型）+沉浸阅读模式；pdf.js 锁 v3（Electron 33 无 toHex）；二进制范围通道必做；大纲/搜索/文本层=v1 硬需求；P1 接 R1 后 |
| agent-file-tools-design.md | 设计定稿 | builtin.vault.{list,read,search,write,edit,rename,trash}；vaultFile 权限域；AI 写=权限控制不打断；modules/*.json 只读可见、cache/config 不可见；F1-F3 |

已弃置：plugin-external-integration.md（外部联动插件，用户四个候选均未用过，暂停）

## 四、未决/可开工项

1. **R1 Workbench 化** = 下一主目标（W1 骨架先行，灰度开关保证可回退）
2. PDF 阅读器 P1 前置：workspaceManager 二进制范围读取通道（现二进制不返内容，Vault 附件读不了）+ 文档类型注册表白名单
3. agent-file-tools F1（只读三件套+权限域）前置齐全（workspaceManager✅+knowledgeIndex✅），可与 R1 并行；Q2 未拍：rename/trash 建议放 F3
4. 图谱 G0（GraphIndex）待排期；双链语法 [[文件名]] vs [[id]] 待知识库重设计时定
5. 知识库模块重设计进行中（另一会话或后续），图谱入口挂载形式 O4 待其定稿
6. 插件转化若要并行开工：开独立分支 feature/plugin-v3；IPC 注册面（main/index.ts、preload、src/lib/ipc.ts）协议先行、实现后合

## 五、环境与协作提醒

- 工作区当前分支 fix/optimize-v2.15.1，另一会话未提交改动多；高危共享文件：electron/main/index.ts、preload/index.ts、src/lib/ipc.ts、src/types/index.ts、App.tsx、package.json
- Tailwind v4：过渡用 `translate` 非 `transform`（历史坑）
- Electron 33：pdf.js 锁 v3 classic worker；渲染层沙箱无 fs、无 window.prompt/confirm（用项目内组件）
- 冒烟脚本在 tmp/smoke/（workspace 43、kbstore 29、knowledge-index 20、migrate-vault 12 等），改动守卫链后必须回归
