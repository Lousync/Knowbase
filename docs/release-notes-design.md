# 更新说明（Release Notes）设计

> 2026-09-12 落 P0。**以后「告诉用户这版做了什么」一律走这套机制**：应用内页面 + CHANGELOG 单一源，
> 不再手写一份「更新公告」贴到官网/仓库 Release 里各说一遍。

## 1. 要解决的问题

发版后用户不知道这版改了什么。官网更新日志（`gh-pages`）和 GitHub Release 都靠人去翻，应用内没有任何出口。

对标对象是 **VS Code 的更新说明页**：升级后自动打开一次，讲清楚「这一版值得注意的几件事」，再往下是完整条目。

## 2. 触发规则（核心决策）

判定是**主进程**做的：`app.getVersion()` 对比仓库里 `.knowbase/modules/release-notes/index.json` 的基线 `lastShown`。

| 情形 | 自动打开 | 是否落盘 |
|---|---|---|
| ① 无基线（全新安装 / 首次见到本仓库） | ❌ | ✅ 把基线记成当前版本 |
| ② 基线同 `major.minor`（含 patch 升级） | ❌ | 仅当基线 ≠ 当前版本时推进基线 |
| ③ 基线 `major.minor` 变了 | `有说明数据 && 开关开着` | ❌ **不落盘**，等渲染层确认 |

三个决策各有理由，都不是随手写的：

- **只看 `major.minor`（「中间版本号的提升」）**：patch 补丁静默升级。用户能接受「小更新不通知」，接受不了「每次小更新都被弹一页」。
- **首装不弹**：新用户先走新手引导，不该在第一次打开软件时再塞一页更新说明。
- **情形③ 故意不落盘**：用户可能根本没看到——刚渲染就崩了、或者立刻切走。基线由页面**成功展示后**回调 `markShown` 写入；否则一次异常启动就把「未读」标成「已读」，用户再没有第二次机会。
- **`markShown` 只认当前版本**：用户翻看 v2.9.0 的历史说明不该把基线拨回去，否则下次真升级时判定窗口就错了（会被判成「同 major.minor」而永不弹）。

规则本体抽在 **`electron/lib/releaseNotes/judge.ts`**（零依赖纯函数），`index.ts` 只做「读 index.json → 判定 → 写回」。
这样做不是为了分层好看：`index.ts` 顶部 `import { app, ipcMain } from 'electron'`，契约脚本在裸 node 下拿不到它，
规则留在那个文件里就**验不了**。

## 3. 数据三层

| 层 | 位置 | 谁维护 |
|---|---|---|
| ① 完整条目清单 | `electron/lib/releaseNotes/data.ts` | **生成**，不手改 |
| ② 本版亮点卡片 | `electron/lib/releaseNotes/highlights.ts` | 人写，发版前维护 |
| ③ 阅读记录 + 留档 | `<仓库>/.knowbase/modules/release-notes/{index.json, v<x.y.z>.json}` | 运行时自动 |

- **① 单一源 = `CHANGELOG.md`**：`node .AGENT/scripts/release-notes/build-release-notes.mjs` 生成。
  解析容错优先于严格——CHANGELOG 是手写文档、格式会漂，遇到不认识的行退化为普通条目而不是丢弃
  （漏条目 = 用户以为这版没做这件事）。生成**不写时间戳**，重跑必须零 diff。
  CHANGELOG 里 `## v2.6.4` 连着写了两次（手写笔误），生成器按版本号归并并告警，不产出幽灵版本。
- **② 为什么亮点要手写**：CHANGELOG 是流水账，念一遍没人看得下去。清单保证「不漏」，亮点负责「讲清楚哪几件事值得看」。
- **③ 为什么落在仓库里而不是全局设置**：仓库 = 账户（本仓既有口径），「这个仓库看过哪几版」属于仓库级事实；顺带把当前版本说明留档，换电脑拷走仓库一起带走，AI 也能读。

生成的是 TS 常量而非 `resources/` 下的 JSON：随 electron-vite 打进主进程包，不需要 `extraResources` 配置，也没有 dev / 生产两条路径分支。

## 4. 渲染层形态：模块页，不是文档 Tab

**本仓没有全局文档 Tab 栏**（`src/components/shared/TabBar.tsx` 全仓零引用）。
所以「主页 tab 模式」落地为**模块页**，与 `aiTeaching` 同构——`src/modules/release-notes/index.tsx`，
在 `App.tsx` 的 `renderModuleContent` 里挂 `case 'releaseNotes'`。

页内两个视图：`current`（本版：亮点卡 + 完整清单）/ `all`（全部 N 个版本列表）/ 点进单个版本可回看历史。

主题自动跟随，**不需要 `welcome.html` 那套 postMessage 握手**：模块页活在渲染层，直接用 `var(--*)` 令牌。

**踩过的坑：模块根节点必须 `h-full`。** 初版写的是 `flex-1`（看着更"弹性"），结果「全部版本」列表**能显示但滚轮没反应**。
根因：槽位容器 `App.tsx` 的 `renderMounted` 是**块级** div（只有 `flex-1 min-h-0`、没有 `flex`），
`flex-1` 在非 flex 容器里完全不生效 → 根节点高度随内容增长、永不溢出 → 内层 `overflow-y-auto` 拿不到可滚高度；
而 `html/body/#root` 是 `overflow: hidden`，溢出部分被直接裁掉，连页面级滚动都没有。

实测对照（复刻真机容器链 + 复用构建产物 Tailwind + 无头浏览器，37 行列表）：

| 根节点 | 槽位高 | 根节点实高 | 滚动视口 | 内容高 | `scrollTop` 实际到达 |
|---|---|---|---|---|---|
| `flex-1` | 219px | **1568px**（撑破槽位） | 1528px | 1528px | **0（滚不动）** |
| `h-full` | 219px | **219px** | 179px | 1528px | **1349（能滚）** |

`help` / `user` / `ai-teaching` / `blog` 四个既有模块的根节点都是 `h-full` —— 这是本仓的既定写法。

## 5. 三个入口

| 入口 | 位置 | 通道 |
|---|---|---|
| 自动 | 启动判定通过后延迟 2s | `setActiveTab('releaseNotes')` |
| 手动 1 | 活动栏齿轮菜单「更新说明」 | `window.dispatchEvent('release-notes:open')` |
| 手动 2 | 设置 → 关于与更新 → 「打开更新说明」 | 同上 |
| 便捷 | 命令面板「打开 更新说明」 | `buildCommandItems` |

延迟 2s 是**刻意错开**标题栏 `updateStartupCheck()` 的 6s 静默检查——它是一次「告知」，不该和启动路径抢网络/IO。
手动入口统一走自定义事件而非 prop，与 `settings:open` / `help:open` / `onboarding:show` 的既有通道一致；
模块页本身不需要知道是谁把它打开的。

活动栏图标列不变（齿轮菜单里加项），两个新设置项挂在 `advanced.releaseNotes` anchor 下。

## 6. 设置项

`src/lib/settings.ts` 的 `SETTINGS` 里两条，`section: 'about'`、`ui: true`、`anchor: 'advanced.releaseNotes'`：

| key | 默认 | 含义 |
|---|---|---|
| `releaseNotesAutoOpen` | `true` | 中间版本号变化时自动打开 |
| `releaseNotesKeepHistory` | `true` | 把展示过的版本说明留档到仓库 |

## 7. 涉及文件

```
新增
  electron/lib/releaseNotes/judge.ts       判定纯函数（零依赖，契约脚本直接验它）
  electron/lib/releaseNotes/index.ts       IPC / 读盘 / 留档
  electron/lib/releaseNotes/types.ts       跨线契约（主进程侧）
  electron/lib/releaseNotes/data.ts        生成物（37 版本 / 340 条目）
  electron/lib/releaseNotes/highlights.ts  手写亮点
  src/modules/release-notes/index.tsx      模块页
  .AGENT/scripts/release-notes/build-release-notes.mjs   CHANGELOG → data.ts
  .AGENT/scripts/release-notes/verify-release-notes.mjs  契约验证

改动（8 处接线）
  electron/main/index.ts        registerReleaseNotesHandlers({ getSettingValue })
  electron/preload/index.ts     4 个 invoke 通道
  src/types/index.ts            TabName + 类型镜像 + ElectronAPI 4 个方法
  src/lib/ipc.ts                4 个包装
  src/App.tsx                   自动打开 + 事件监听 + 命令面板 + 渲染 case
  src/lib/settings.ts           2 个设置项
  src/modules/settings/views/AboutView.tsx   开关 + 打开按钮 + 版本数
  src/components/shared/ActivityBar.tsx      齿轮菜单项
```

## 8. 怎么验

```bash
# 契约（结构完整性 / 亮点对齐 / 判定真值表 / data 与 CHANGELOG 同步 / 发版窗口）
node --experimental-strip-types --no-warnings .AGENT/scripts/release-notes/verify-release-notes.mjs

# 类型门禁（build 通过 ≠ 类型正确）
npx tsc --noEmit -p tsconfig.node.json
npx tsc --noEmit -p tsconfig.web.json

# 改了 CHANGELOG 后必须重跑生成器（§4 会拦住忘记跑的情况）
node .AGENT/scripts/release-notes/build-release-notes.mjs
```

**dev 下联调自动打开**：`app.getVersion()` 在 dev 恒为 `package.json` 的版本，
用 `KNOWBASE_FAKE_APP_VERSION=<某版本> app.getVersion()` 覆盖（仅未打包生效），
或直接改仓库里 `index.json` 的 `lastShown` 造基线。

## 9. 待办

- [ ] **v3.1.0 亮点文案待志岩审核**（`highlights.ts`，数字均取自本仓实测）
- [ ] **`CHANGELOG.md` 还没有 `## v3.1.0` 小节** → `data.ts` 里也就没有 3.1.0，
      当前那 5 张 3.1.0 亮点卡**不会显示**。发版时补小节 + 重跑生成器即可（verify 脚本以 ⚠️ 提示，不算失败）
- [ ] P1：动效演示区（6 个可交互 demo 组件 + `> demo:` 内联指令 + `docs.html` 忽略规则）
- [ ] 官网更新日志页与这里的口径统一（37 版本全量内联 vs 近年 + Releases 链接，待定）
