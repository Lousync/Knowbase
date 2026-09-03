import type { Migration } from './types'

/**
 * 删除 recycle_bin 表（去库化：回收站模块废弃）。
 *
 * 用户 2026-09-03 拍板：回收站不作为单独模块——应用内删除一律走系统回收站
 * （文件 trash 包 / 条目直删），入口从侧栏迁到「设置与主题」菜单直达 OS 回收站。
 * 本表承载的"全文 JSON 载荷 + 恢复回写"双轨语义废弃，库随模块一起清掉。
 *
 * 历史数据说明：此前的回收站快照随表删除（不可再经 UI 恢复）——
 * 文件型内容（博客/知识页）删除即进系统回收站，本就由 OS 负责恢复，无数据损失；
 * 仅 sqlite 行级快照（说说/密码本等）不可恢复，属既有产品决策的收敛。
 */
export const m056DropRecycleBinMigration: Migration = {
  name: '056_drop_recycle_bin',
  up: (db) => {
    db.run(`DROP TABLE IF EXISTS recycle_bin`)
  },
}
