/**
 * 手写亮点 —— 更新说明页**上部**的精写卡片。
 *
 * 与 `data.ts`（下部完整条目清单，由 CHANGELOG 自动生成）是两层：
 * - 清单保证「不漏」——脚本从 CHANGELOG 同步，条目数对不上会报错；
 * - 亮点负责「讲清楚哪几件事值得看」——CHANGELOG 是流水账，念一遍没人看得下去。
 *
 * 2026-09-12 按 tmp/release-notes-proto/release-notes.html 原型改写：
 * 分节卡片（section 聚类）+ 顶部摘要行（brief）+ 卡内可折叠「全部改动」
 * + 右侧可重播动效演示区（demo）。
 *
 * 维护：发版前为新版本追加一组（version 字段对齐 app.getVersion()，不带前导 v）。
 * 约束见 verify-release-notes.mjs：单版本 ≤6 条、desc ≤240 字、版本必须在 data.ts 里存在。
 */
import type { ReleaseNoteHighlight } from './types'

export const RELEASE_NOTE_HIGHLIGHTS: readonly ReleaseNoteHighlight[] = [
  {
    version: '3.1.0',
    section: '日程',
    title: '任务截止提醒 接到系统通知',
    tag: '新增',
    desc: '任务到点会发一条**系统通知**（Windows 操作中心），不只在软件里弹提示条。提前量可设分钟到天，逾期可重复提醒；免打扰时段内不打扰，出时段后自动补发一条汇总，不会逐条轰炸。',
    briefLead: '截止提醒',
    briefRest: '接到系统通知',
    links: [{ label: '设置 → 提醒' }],
    changes: [
      '提醒时刻 = 截止时间 − 提前量，按绝对时刻计算',
      '已完成、子任务、打盹中的任务不重复提醒',
      '免打扰默认 22:30 – 07:30，支持跨天区间',
      '启动时若积压多条，合成一条汇总通知',
      '点通知直接跳到该任务所在面板',
    ],
    demo: {
      kind: 'notify',
      title: '任务即将截止',
      message: '「整理 408 真题错题」还有 30 分钟',
      caption: '系统通知 · Windows 操作中心',
    },
  },
  {
    version: '3.1.0',
    section: 'AI 助手',
    title: '一次查询的返回瘦了一半',
    desc: '批量查询默认从 50 条收到 20 条，单次返回硬上限 `24000` 字符，更早的历史结果会渐进压缩。同一批错题，返回体积从约 **6990 token** 降到约 **2460 token**；同时接入提示缓存，逐轮不变的部分不再全价重发。',
    briefLead: '工具返回',
    briefRest: '省下约 65%',
    changes: [
      '批量查询默认 limit 50 → 20（上限 200 → 100）',
      '单条工具结果超 24000 字符换摘要 + 预览，不再灌全文',
      '最近 3 条结果保持完整，更早的大结果压成标量摘要',
      'system 与工具表打缓存断点，命中量计入用量观测',
      '供应商级错误自动故障转移，不再整轮失败',
    ],
    demo: {
      kind: 'compare',
      rows: [
        { label: '改前', display: '6990', width: 100 },
        { label: '改后', display: '2460', width: 35, after: true },
      ],
      caption: '同一批 127 条错题的返回体积（token）',
    },
  },
  {
    version: '3.1.0',
    section: '错题本',
    title: '数据面板重做',
    tag: '重做',
    desc: '原来的面板列的是内部表名，且恒为 0 行。现在改成你关心的口径：题目、待复习、已掌握、收藏、备注、今日答错、正确率，另加**按错次档位**与**按书**两条分布。',
    links: [{ label: '查看我的数据' }],
    changes: [
      '错题本退役插件双轨，工具族全部内置化',
      '判题一律写仓库主表，不再按模式分流',
      '概览 6 卡 + 按错次档位 / 按书两条分布',
      '导出备份与分级清空（内联二次确认）',
      '存量插件数据保留迁移 / 导出 / 清理通道',
    ],
    demo: {
      kind: 'dist',
      rows: [
        { label: '顽固错', display: '30', width: 100 },
        { label: '中错', display: '30', width: 100 },
        { label: '轻错', display: '36', width: 100 },
        { label: '已掌握', display: '12', width: 40 },
      ],
      caption: '演示仓库 127 条记录 · 按错次档位',
    },
  },
  {
    version: '3.1.0',
    section: '界面',
    title: '所有操作都带动效',
    desc: '面板开合、列表增删、弹层进出、按钮与开关反馈、视图切换、状态提示，统一走同一套动效令牌。全部动画只动 `transform` 与 `opacity`，并跟随系统的「减少动态效果」设置。',
    briefLead: '动效',
    briefRest: '覆盖到所有操作',
    changes: [
      '动效令牌统一（micro/std/large/view 四档 + 两条缓动曲线）',
      '动画只动 transform 与 opacity，不触发重排',
      '系统「减弱动态效果」开启时全套自动降级',
      '拖拽跟手过程刻意不加动画',
      '左栏多层树加缩进层级参考线（实线 / 虚线 / 关闭）',
    ],
    demo: {
      kind: 'mini-list',
      items: [
        { text: '背 60 个考研词汇', done: true },
        { text: '整理 408 错题', done: true },
        { text: '跑步 30 分钟' },
        { text: '读《深入理解计算机系统》' },
      ],
      caption: '列表入场 + 完成反馈',
    },
  },
  {
    version: '3.1.0',
    section: '界面',
    title: '目录聚焦：侧栏只留当前路径',
    tag: '新增',
    desc: '文件一多，侧栏就是半个应用在滚动。点一下编辑器 / 知识库侧栏的**准星按钮**，树里只保留当前打开文件的目录链和同级文件，其余目录收成骨架条——悬停显原名，点击定位并退出聚焦。',
    briefLead: '目录聚焦',
    briefRest: '侧栏只留当前路径',
    links: [{ label: '设置 → 编辑器 → 目录聚焦样式' }],
    changes: [
      '编辑器 / 知识库侧栏各一个准星开关，状态重启保留',
      '骨架式：链外目录保留占位条，悬停显示原名',
      '隐藏式：只留当前目录链，更干净',
      '目录只认链条（同级零散目录也失焦），同级文件保留实名方便切换',
      '点击骨架条 = 退出聚焦并定位展开',
    ],
    demo: {
      kind: 'compare',
      rows: [
        { label: '全部展开', display: '23', width: 100 },
        { label: '聚焦后', display: '6', width: 26, after: true },
      ],
      caption: '演示目录树 · 同屏可见条目数',
    },
  },
  {
    version: '3.1.0',
    section: '更新说明',
    title: '「更新说明」它自己来了',
    tag: '新增',
    desc: '从这一版开始，中间版本号变化后，应用会自己把这一版做了什么摊开给你看——就是你现在读的这一页。亮点卡讲清楚值得看的几件事，完整清单由 `CHANGELOG.md` 单一源生成、一条不漏。',
    links: [{ label: '设置 → 关于与更新' }],
    changes: [
      '只在 x.y（中间版本号）变化时自动出现一次，patch 静默',
      '全新安装不弹——新用户先看新手引导',
      '页面成功展示后才写阅读基线，异常启动不吞掉未读',
      '阅读记录随仓库保存，换电脑拷走即带走',
    ],
  },
]
