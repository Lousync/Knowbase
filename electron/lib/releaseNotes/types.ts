/**
 * 更新说明（release notes）的数据契约 —— 主进程侧。
 *
 * 渲染层有一份**镜像声明**在同名结构里（见 src/types/index.ts）：
 * 两个 tsconfig 互不可见（tsconfig.node 不含 src、tsconfig.web 不含 electron），
 * 沿用本仓「跨线类型在各侧各声明一次」的既有做法。
 */

/** 分组类别：只影响渲染时的徽标与配色，不参与数据语义 */
export type ReleaseNoteKind = 'feature' | 'ux' | 'fix' | 'internal' | 'other'

export interface ReleaseNoteItem {
  /** `- **标题**：正文` 里的粗体标题（已去尾冒号）；没有粗体前缀时为空串 */
  readonly lead: string
  /** 条目正文。已剥掉 Markdown 粗体标记，反引号保留给渲染层做行内 code */
  readonly rest: string
  /** 缩进子项（已拍平为纯文本） */
  readonly sub: readonly string[]
}

export interface ReleaseNoteGroup {
  readonly title: string
  readonly kind: ReleaseNoteKind
  readonly items: readonly ReleaseNoteItem[]
}

export interface ReleaseNote {
  /** 不带前导 v，如 `3.0.0` / `1.6.0-programmer.1` */
  readonly version: string
  /** CHANGELOG 原文里的日期，缺省为空串（老版本多数没写日期） */
  readonly date: string
  /** 版本块顶部的引用块摘要（部分版本没有） */
  readonly summary: string
  readonly groups: readonly ReleaseNoteGroup[]
}

/**
 * 手写亮点 = 页面上部那几张精写卡片（与 CHANGELOG 自动生成的清单是两层）。
 * 条目清单保证「不漏」，亮点负责「讲清楚哪几件事值得看」。
 */
export interface ReleaseNoteHighlight {
  /** 所属版本（不带前导 v） */
  readonly version: string
  readonly title: string
  readonly desc: string
  /** 可选的补充一行（放实测数字、边界说明之类） */
  readonly detail?: string
}

/** `.knowbase/modules/release-notes/index.json` 的形状 */
export interface ReleaseNotesIndex {
  /** 上次向用户展示过的版本（不带前导 v）；空串 = 从未展示 */
  lastShown: string
  /** 首次见到某版本的记录（用于区分「全新安装」与「升级」） */
  seen: string[]
  updatedAt: string
}

/** 启动时一次性回给渲染层的判定结果 */
export interface ReleaseNotesState {
  /** 当前应用版本（`app.getVersion()`） */
  currentVersion: string
  /** 是否有对应版本的更新说明数据 */
  hasNotes: boolean
  /** 是否应当自动打开更新说明页 */
  shouldAutoOpen: boolean
}

/** jsonStore 的 module 参数。沿用本仓「模块数据一律在 .knowbase/modules/<模块>/」的口径 */
export const RELEASE_NOTES_MODULE = 'modules/release-notes'
export const RELEASE_NOTES_INDEX_KEY = 'index.json'
