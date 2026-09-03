/**
 * 图谱数据契约（web 侧单源类型）。
 * electron 侧 `electron/lib/kbStore/graphIndex.ts` 反向 import 本文件（wordbookTypes 先例）。
 * 结构对应 `.knowbase/cache/graph.json`（schemaVersion 1），字段勿单独改动——两端一致。
 */

export interface GraphNode {
  id: string
  title: string
  /** 仓库内相对路径；tag / dangling（未解析引用虚节点）为空串 */
  path: string
  kind: 'page' | 'tag' | 'dangling'
  /** 无向关联数（页页边 + 页标签边）；dangling 为引用它的源页数 */
  degree: number
}

/** 去重后的无向边（页-页 / 页-标签） */
export interface GraphEdge {
  s: string
  t: string
}

/** 未解析 [[引用]] 聚合成的虚节点数据 */
export interface UnresolvedRef {
  name: string
  /** 引用它的源页 id 列表（去重） */
  refs: string[]
}

export interface GraphIndexData {
  schemaVersion: 1
  builtAt: string
  nodes: GraphNode[]
  edges: GraphEdge[]
  unresolved: UnresolvedRef[]
  /** resolved 反链索引：目标页 id → 引用它的源页 id 列表（供知识库反链面板） */
  incoming: Record<string, string[]>
}

/** 图谱视图设置（.knowbase/config.json graphView 段；默认值见 electron repoConfig.GRAPH_VIEW_DEFAULTS） */
export interface GraphViewConfig {
  linkDistance: number
  chargeStrength: number
  showTags: boolean
  showOrphans: boolean
  colorBySpace: boolean
  clusterForce: boolean
  labelThreshold: number
}
