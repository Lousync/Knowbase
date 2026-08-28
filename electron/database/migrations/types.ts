import type { Database as SqlJsDatabase } from 'sql.js'

/**
 * 单个数据库迁移。
 *
 * 约定：
 * - `name` 会原样写进 `_migrations` 表做幂等判定，**已经发布过的名字永远不能改**，
 *   否则老用户升级时该迁移会被当成新迁移重新执行。
 * - `up` 抛错会触发整个迁移批次回滚（见 connection.ts 的 runMigrations）。
 *   因此「可容忍的失败」必须在 up 内部自行 try/catch，不要向外抛；
 *   只有真正致命、必须中断启动的错误才抛出去。
 */
export interface Migration {
  /** 唯一标识，写入 _migrations 表 */
  name: string
  /** 迁移主体，接收已打开的数据库实例 */
  up: (db: SqlJsDatabase) => void
  /**
   * 是否需要执行，默认「未应用过即执行」。
   *
   * 少数修复型迁移（如 018）只在其前序迁移已被标记为已应用时才有意义，
   * 这类迁移需要覆写本方法表达额外前置条件。
   */
  shouldRun?: (applied: Set<string>) => boolean
}
