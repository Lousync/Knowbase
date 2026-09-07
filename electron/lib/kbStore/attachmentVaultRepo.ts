import { readJson, writeJson } from './jsonStore'

/**
 * 附件台账 vault 数据仓库（去库化 R6 / D9）：`.knowbase/modules/attachments/registry.json`
 *
 * 行结构与 sqlite attachments 表一致（snake_case 原样保留，与迁移器
 * vaultMigration.planTable 产物、回收站快照兼容）；附件文件本体仍在 userData/attachments，
 * 台账只记录相对路径（file_path / thumb_path / trash_path）。
 */
export interface AttachmentRow {
  id: string
  owner_type: string
  owner_id: string
  position: number
  file_name: string
  file_path: string
  thumb_path: string
  mime_type: string
  size_bytes: number
  trashed: number
  trash_path: string
  created_at: string
}

const MOD = 'modules/attachments'
const FILE = 'registry.json'

export function vaultAttachmentsAll(): AttachmentRow[] {
  return readJson<AttachmentRow[]>(MOD, FILE, [])
}

export function vaultAttachmentsSave(rows: AttachmentRow[]): void {
  writeJson(MOD, FILE, rows)
}
