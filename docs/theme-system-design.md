# 主题与外观系统设计（Theme System）

> 归属：[rework-master-plan.md](./rework-master-plan.md) 路线图建议 **R5.5**（R5 Live Preview 定稿编辑器 DOM 之后、R7 插件开放之前）。
> 状态：**设计讨论稿 v0.1（2026-09-03）**，细节待拍板（开放问题见 §7）。
> 目标用户：① 个人重度定制 ② 插件/主题生态铺路 —— **两路合一，不做两套系统**。
> 范围：本文只覆盖**样式外观**（变量 / 主题包 / manifest / 设置表单 / CSS 注入）。布局重组与「工作区快照」（对标 Obsidian Workspaces）属 Workbench 布局子系统，另行成文，不在本文展开。

---

## 1. 立项理由与借鉴分层

对标 Obsidian / VS Code 后，用户的"自定义界面"诉求可拆为四层。**关键事实：Obsidian 与 VS Code 都没有"任意摆放控件"能力**——它们给用户的是三权：样式全覆盖权、固定壳体内布局重组权、布局快照切换权。Knowbase 对齐该路线，不做自由画布（可预期性 > 自由度）。

| 层 | Obsidian 对应 | VS Code 对应 | 归属 |
|---|---|---|---|
| L1 设计 Token 化（换肤底座） | 主题 = 一套 CSS 变量 | color theme | 本文（主体） |
| L2 CSS 注入（snippet） | CSS snippets |（无官方，靠 hack） | 本文（主体） |
| L3 布局重组 + 工作区快照 | 自带布局记忆 + Workspaces | workspace state | 布局子系统，另行成文 |
| L4 声明式主题参数（表单） | Style Settings 插件 |（无对应） | 本文（v1.1 起，生态窗口） |

**两路合一的依据**：个人重度定制 = 往 userData 丢一个 CSS 文件；生态主题包 = 同一份 CSS + 一个 manifest。若实现为同一级联运行时，个人资产随时可"补个 manifest 打包上市场"，零迁移成本；反之做两套加载器必然重复且互相打架。

## 2. 现状盘点（实测 2026-09-03）

**好消息：L1 的地基已经存在约 80%。**

- 全部设计 token 已收敛为 CSS 变量，集中在 `src/styles/index.css`（411 行，Tailwind v4 CSS-first），命名是 VS Code 风格语义分组：`--bg-primary/secondary/tertiary/hover/selected`、`--activitybar-bg`、`--sidebar-bg`、`--input-bg`、`--card-bg`、`--text-*`、`--accent*`、`--danger/--success/--warning`、`--border-color`、`--font-sans/--font-mono`、`--radius-card/--radius-btn`、`--shadow-card`、`--divider-style`、`--heading-rule`、`--link-hover-deco`、`--quote-bar`
- 主题切换机制是 **`html.theme-<id>` 覆写块**：`:root` 内是暗色默认值，`html.theme-light { … }` 覆写为亮色；注释明说"新增主题只需加一个同名块"——**静态多主题能力已就绪**
- 组件消费方式是 Tailwind arbitrary value（`bg-[var(--bg-primary)]`），变量一变全局跟着变，**主题包覆写变量即可全量生效**
- 已有 sketch 基建：index.css 内预留了手绘风格可覆写点（`--divider-style/--heading-rule/--quote-bar/--link-hover-deco`），对应手绘主题的探索

**缺口（本文要补的）**：

1. 无**用户级覆盖注入层**（custom.css 无入口、无热重载）
2. 无**主题包格式**与 manifest（主题停留在"改源码 css 加块"）
3. 无**设置面板表单**（深浅切换之外，无法可视化调 accent/圆角/字号）
4. 无 **snippet 结构性注入**（用户 CSS 无稳定可预期的挂载面）
5. 无**结构钩子契约**（`data-kb-*`）文档——用户 CSS 依赖的 class/属性没有冻结清单，会随版本漂移

## 3. 核心设计：单级联运行时

三层来源按优先级从低到高（**后声明者胜**，CSS 变量覆写天然实现）：

```
用户覆盖（最高）   userData/skins/custom/theme.css + snippets/*.css
   ↑
主题包（激活一个） userData/skins/<id>/theme.json + theme.css + snippets/*.css
   ↑
内置 token         src/styles/index.css :root + html.theme-<id> 块
   ↓
单入口注入         <style data-kb-theme> 拼接注入（变量覆写 → 结构 snippet）
   ↓
消费方 1: 渲染层   全部组件经 var() 消费，即时生效
消费方 2: 设置面板  读取激活源 manifest → 自动渲染 color/range/select 表单 → 改的就是 CSS 变量
```

要点：

- **一个 style 节点、一份级联顺序**：渲染层启动/切换主题时，把「内置变量集 + 激活主题包覆写 + 用户覆写」按序拼成 CSS 注入 `<style data-kb-theme>`；结构 snippet 依同序拼接在后。不做第二套注入器。
- **manifest 一份声明两个消费者**：主题作者声明的 `variables[]`（cssVar + type + 默认值）既被级联器用于覆盖目标，又被设置面板用于自动生成表单。个人窗口的外观面板微调 = 内置"伪主题包"的同一机制。**L1 与 L4 因此是同构的，不是一个功能的两份实现。**
- **主题 = 无 manifest 的用户包**：`skins/custom/` 目录结构与主题包完全一致，只是没有 theme.json。将来"打包为主题包上市场"= 补一个 theme.json + zip。
- **热重载**：dev 下 watch `skins/` 目录，改动即重新级联；生产用设置页"重新加载外观"按钮兜底。
- **数据边界**：遵循 master-plan §4——主题/字体/缩放属**设备级**（`userData/skins/`），不跟仓库走（与 Obsidian 全局主题一致，换仓库不换主题）。

## 4. 契约（生态地基 —— 需冻结的部分）

以下三条是生态能成立的前提。**冻结时机建议在 R5 之后**：R5（Live Preview / CM6）是编辑器 DOM 最后一次大改，钩子契约若在 R5 前冻结必然返工。

### 4.1 变量清单 = 公共契约

现有无前缀变量体系已成型且被全量组件消费，**不建议引入 `--kb-` 统一前缀**（全量改动成本 vs 收益不划算，Obsidian 同样无前缀）。契约 = 语义分组 + 命名规则 + 清单文档：

- 分组命名：`--bg-*`（表面）/ `--text-*`（文字）/ `--accent*`（强调）/ `--danger|success|warning`（状态）/ `--border-*`（描边）/ `--font-*`（字体）/ `--radius-*`（圆角）/ `--shadow-*`（阴影）/ `--divider-*`（分割线）/ `--heading-*`（标题规则）/ `--quote-*`（引用）/ `--link-*`（链接）
- 规则：**新增变量必须落入既有分组**；组件禁止硬编码颜色/圆角值（审计项）；主题包只允许覆写契约清单内变量
- 产出：`docs/theme-variables.md`（清单 + 语义 + 默认值，随代码同步维护）——本文档定稿后单独生成

### 4.2 结构钩子 `data-kb-*`

用户 CSS 要对结构生效，必须依赖稳定选择器。原则：**钩子只增不改**（版本演进只新增属性值，不改变义）。

首批范围（高频 UI，挂载优先级高）：`data-kb-activitybar` / `data-kb-sidebar` / `data-kb-titlebar` / `data-kb-statusbar` / `data-kb-tabbar` / `data-kb-editor` / `data-kb-command-palette` / `data-kb-panel` / `data-kb-graph`。各模块内部结构钩子随 R5/R6 重构顺手补挂，不单独排期；**文档随挂随更**。

### 4.3 主题包结构与 manifest schema v0.1

```
<id>/                      # = userData/skins/<id>/
  theme.json               # manifest（必需）
  theme.css                # 变量覆写（可选，缺省 = 仅用内置变量）
  snippets/*.css           # 结构性覆写（可选，自动全量载入）
```

```jsonc
{
  "schema": 1,                       // 格式版本，演进只增字段，向后兼容
  "id": "handdrawn",                 // = 目录名，^[a-z][a-z0-9._-]{0,63}$
  "name": "手绘风格",
  "author": "志岩",
  "version": "0.1.0",
  "base": "light",                   // 可选：覆写哪套基线（null = 深浅两套变量都覆写）
  "variables": [                      // 声明可调项：级联注入 + 设置表单 共用
    { "id": "accent", "label": "强调色", "group": "颜色",
      "type": "color", "cssVar": "--accent", "default": "#0078d4" },
    { "id": "card-radius", "label": "卡片圆角", "group": "形态",
      "type": "range", "cssVar": "--radius-card", "min": 0, "max": 24, "step": 1, "default": 8 },
    { "id": "font-sans", "label": "正文字体", "group": "字体",
      "type": "select", "cssVar": "--font-sans",
      "options": [{ "label": "系统", "value": "-apple-system, 'Segoe UI', sans-serif" }],
      "default": "-apple-system, 'Segoe UI', sans-serif" }
  ]
}
```

- `type` 先支持 `color | range | select`（toggle 如需再做）；`group` 决定表单分区
- 用户层自定义（`skins/custom/`）也允许携带自己的 theme.json，效果 = 在用户文件里开一张自己的微调表单

## 5. 分期（三窗口）

| 版本 | 窗口 | 内容 | 验收 |
|---|---|---|---|
| **v1** | 个人（现在可动） | ① 硬编码值审计收口（组件禁裸色值）② 设置页「外观」面板：深浅/跟随 + accent/圆角/字号微调（写变量）③ `skins/custom/` 注入 + 热重载 | 面板微调与 custom.css 都能覆盖任意 token |
| **v2** | 契约（R5 后冻结） | ① 变量清单文档 + data-kb-* 钩子 v1 全量挂载 ② theme.json 运行时（校验/激活/回退）③ manifest → 设置表单自动生成 | 手工装一个手绘主题包，表单可调、一键回内置 |
| **v3** | 生态（R7） | 主题包走市场安装通道、主题类目、签名轻量通道 | 市场可装可更可卸载主题 |

R5.5 与 R6（删库，纯数据层）不冲突，实际排期可先做 v1 + v2 契约冻结，v3 等 R7 通道。

## 6. 安全与性能

- **纯 CSS 渲染层自伤**：主题/snippet 不进主进程、无 Node 能力、不触发 IPC。安全审查门槛比 code 插件低一个量级 → **主题包走市场轻量快车道**（与 sandbox + capability gateway 的 code 插件通道互补，不是替代）
- 渲染层本身在 sandbox 中，CSS 无提权面；但仍建议：主题包安装时 size 上限（如 5MB）、zip 防路径穿越（复用现有 zip 校验链）
- 级联注入 = 常量级文本拼接，无运行开销；热重载用防抖
- 回退：theme.json 解析失败 / CSS 语法错误 → 跳过该层并提示，绝不阻塞启动

## 7. 开放问题（待拍板）

- **Q1**：是否引入 `--kb-` 统一前缀？（本文倾向否：现状无前缀体系已成型，前缀化收益仅命名空间隔离，成本是全量变量与组件改动；生态契约用"分组规则 + 清单文档"代替前缀）
- **Q2**：钩子契约冻结时机 = R5 后（建议）还是现在就随 v1 挂第一批？早挂的好处是个人 custom.css 立即有稳定面，代价是 R5 可能返工
- **Q3**：跟随系统（亮/暗）实现——现为手动 `theme-light` 块，需原生 prefers-color-scheme 联动方案（html 级 class 由 JS 切，还是 CSS 媒体查询兜底）
- **Q4**：custom.css 挂载面 = 顶层 html 选择器（现状变量全挂在 `:root`/`html.theme-*`，用户覆写挂 `html` 即可），snippet 是否需要 scoped 约定（如仅限 `.prose-content` 类内容区）——影响文档写法
- **Q5**：内置"主题"与主题包的关系——内置浅/深是否重构为两个内置主题包（`skins/builtin-light/`），让设置面板与主题包走完全同一条路径（推荐，消除特例）

## 8. 关联

- 变量清单文档 `docs/theme-variables.md`（v2 冻结时生成）
- 布局重组与工作区快照（Obsidian Workspaces 对标）→ 布局子系统文档，另行成文
- 市场主题类目与签名 → R7（`plugin-api-v2-design.md` 修订时预留类目字段）
- sketch 手绘基建：index.css 内 `--divider-style/--heading-rule/--quote-bar/--link-hover-deco` 为手绘主题包覆写点（首个吃这套系统的主题）
