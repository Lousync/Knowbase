import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { randomUUID } from 'crypto'
import { getCurrentVault } from './vaultContext'
import type { GraphViewConfig } from '../../../src/lib/graphTypes'

/**
 * 仓库级配置（R4-G3 首次引入）：.knowbase/config.json。
 * 只读/写白名单段（当前仅 graphView 图谱参数）；未来其它仓库级设置扩段。
 * 无当前仓库或文件缺失 → 返回默认；配置跟仓库走（design §6）。
 */

export interface RepoConfig {
  schemaVersion: 1
  graphView?: Partial<GraphViewConfig>
}

export const GRAPH_VIEW_DEFAULTS: GraphViewConfig = {
  linkDistance: 130,
  chargeStrength: -320,
  showTags: true,
  showOrphans: true,
  colorBySpace: false,
  clusterForce: false,
  labelThreshold: 0.6,
}

const GRAPH_VIEW_KEYS = new Set<string>(Object.keys(GRAPH_VIEW_DEFAULTS))

function configPath(): string | null {
  const cur = getCurrentVault()
  if (!cur) return null
  return join(cur.rootPath, '.knowbase', 'config.json')
}

function readRaw(): RepoConfig | null {
  const p = configPath()
  if (!p || !existsSync(p)) return null
  try {
    const raw = JSON.parse(readFileSync(p, 'utf-8')) as RepoConfig
    if (!raw || typeof raw !== 'object' || raw.schemaVersion !== 1) return null
    return raw
  } catch {
    return null
  }
}

/** 读图谱视图配置（默认值合并，保证全字段） */
export function readGraphViewConfig(): GraphViewConfig {
  const raw = readRaw()
  const gv = raw?.graphView ?? {}
  const out = { ...GRAPH_VIEW_DEFAULTS }
  for (const k of Object.keys(out) as (keyof GraphViewConfig)[]) {
    const v = (gv as Record<string, unknown>)[k]
    if (typeof v === typeof out[k]) out[k] = v as never
  }
  return out
}

/**
 * 更新图谱视图配置（仅收白名单键），原子写盘，返回合并后全字段。
 * 不暴露仓库路径给渲染层；无仓库时只改内存（返回默认合并）。
 */
export function updateGraphViewConfig(patch: Partial<GraphViewConfig>): GraphViewConfig {
  const cur = readGraphViewConfig()
  const next: GraphViewConfig = { ...cur }
  for (const k of GRAPH_VIEW_KEYS) {
    const key = k as keyof GraphViewConfig
    const v = (patch as Record<string, unknown>)[k]
    if (v !== undefined && typeof v === typeof cur[key]) next[key] = v as never
  }
  const p = configPath()
  if (p) {
    try {
      const raw = readRaw() ?? { schemaVersion: 1 } as RepoConfig
      raw.graphView = next
      mkdirSync(dirname(p), { recursive: true })
      const tmp = join(dirname(p), `.config-${randomUUID()}.tmp`)
      writeFileSync(tmp, JSON.stringify(raw, null, 2), 'utf-8')
      try {
        renameSync(tmp, p)
      } catch {
        // Windows 下目标存在时 rename 可能失败 → 删旧再换
        try { unlinkSync(p) } catch { /* 目标可能不存在 */ }
        try { renameSync(tmp, p) } catch { /* 仍失败则丢弃临时文件 */ }
      }
    } catch {
      /* 写失败静默：设置不进不影响功能 */
    }
  }
  return next
}

/** 读全量仓库配置（供调试/扩展） */
export function readRepoConfig(): RepoConfig {
  return readRaw() ?? { schemaVersion: 1 }
}
