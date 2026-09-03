# 插件开放与沙箱运行时设计（v3 方向）

> 归属：[rework-master-plan.md](./rework-master-plan.md) D3 / R7 阶段。状态：方向定稿，**需据此修订 `plugin-api-v2-design.md`**，本文记录修订原则与缺口。

## 1. 信任模型变化（拍板核心）

| | v2 设计（原红线） | v3 方向（拍板后） |
|---|---|---|
| 插件形态 | 纯声明式（提示词/内容包/配置），不执行代码 | **可执行 JS**（事件、UI、逻辑） |
| 信任来源 | 不执行 → 无需信任 | **市场 = 作者个人开发+审核**（受信供应链，对标早期 Obsidian 官方精选） |
| 安全手段 | 不执行代码 | **沙箱运行时 + capability 授权 + 包签名** |

结论：安全边界从「代码根本不跑」后移为「代码跑了，但只能经授权通道触达系统」。审核负担从「逐行读代码防漏洞」降为「审 manifest 申请的能力清单」。

**基线修正（2026-09-02 12:30 实测）**：当前 `pluginRegistry.ts` 已支持 `type: 'ui'` 插件 + `capabilities`（≤10 项强制校验）+ `grantedCapabilities` + contributions（tables/views/tools）按能力门禁——**v3 是在已有骨架上的能力面扩展，不是从零建**。已有：插件执行外壳（PluginFrame 桥接）+ capability 校验链路；缺：kb.vault/kb.store/kb.net 等命名空间、签名、Worker 后台通道。

## 2. 红线修订

- ~~不执行插件代码~~ → **执行，但关沙箱里**
- **保持不变**：渲染层不接触绝对路径；读不到 DPAPI 密钥区；不能跨仓库；AI 注册工具仅经 Gateway 白名单
- 新增：插件代码**永远拿不到** `ipcRenderer`、`fs`、`NodeAPI`；一切能力经 Gateway

## 3. 运行时选型（待评审）

| 方案 | 机制 | 评估 |
|---|---|---|
| A. 沙箱 iframe + postMessage | 插件跑隐藏 iframe（sandbox 属性禁同源），经 postMessage 调 Gateway | 现有 PluginFrame 通道可演进；UI 插件天然支持；**倾向方案** |
| B. Worker / UtilityProcess | 插件逻辑跑独立线程/进程 | 隔离更强、无 DOM（UI 需另走 iframe）；适合计算型插件，v3 作为 B 类插件通道保留 |
| C. vm/Node VM | 主进程内虚拟化 | 隔离强度不足，否决 |

v3 = A（UI 插件）+ B（后台任务插件）双通道，同一套 Gateway 协议（协议 v2 已带 id 配对与 bridge token，直接复用）。

## 4. capability 网关（复用 PluginHostGateway 设计）

- manifest v2 的 `capabilities` 声明 + 安装时用户确认 + 主进程 `assertDataAccess` 单点裁决（v2 已设计，原样保留）
- 命名空间增量：`kb.vault.*`（文件读写，经 resolveSafe）、`kb.ui.*`（注册视图/命令面板命令）、`kb.events.*`（订阅保存/打开等事件）
- **权限 UI**：安装页展示能力清单（如「读写仓库内 .md」「发送 AI 请求」），运行时敏感操作二次确认沿用 MCP 双确认模式

## 5. 供应链加固

- 市场包**签名**（作者私钥签名 + 应用内置公钥校验），下载链路（ghproxy→jsDelivr→直连）被篡改可检出
- 版本更新强制增量校验；本地已修改插件保持 userModified 保护
- 插件依赖不落 node_modules：打包期 bundle 成单文件（避免传递依赖投毒面）

## 6. 分期（并入 R7）

| 期 | 内容 |
|---|---|
| V3-1 | 修订 v2 文档与 manifest（capabilities 扩展 + signing 字段） |
| V3-2 | 沙箱 iframe 通道 + Gateway 升级（裁决点收敛主进程，落地 v2 已诊断的三处错层问题） |
| V3-3 | 首个可执行插件试点（建议：命令面板插件命令 or 图谱布局小工具） |
| V3-4 | 签名链路 + 市场发布脚本扩展 |

## 7. 与既有结论的关系

- `plugin-api-v2-design.md` 的三大核心结论（裁决点收敛主进程 / kb.vault 复用 resolveSafe / kb.store 落 .knowbase/plugins）**全部继续成立**，本文只改「是否执行代码」这一前提
- `kb.ai.registerTool(fn)` 仍不开放（AI 工具面另走审计链路）
