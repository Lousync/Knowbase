import { exists, readJson, writeJson } from './jsonStore'

/**
 * 体重记录 vault 数据仓库（去库化 P2，storageData=vault）
 *
 * 存储：.knowbase/modules/weight/records.json（裸数组，一元素=一行）
 * 行结构与 sql.js 表 `toolbox_weight_records` 完全一致（snake_case 原样保留，
 * 与迁移器/导出产物兼容，避免双格式）；DTO 转换（camelCase）留在
 * electron/database/repositories/weightRepo.ts，两种模式共用同一 rowToWeight。
 */
export interface WeightVaultRow {
  id: string
  weight: number
  date: string
  series: string
  note: string | null
  created_at: string
}

const MOD = 'modules/weight'
const FILE = 'records.json'

/** JSON 文件是否已存在（区分「未播种」与「已迁 vault 但当前为空」） */
export function vaultWeightExists(): boolean {
  return exists(MOD, FILE)
}

/** 全部记录：按 date 升序（与 sqlite `ORDER BY date ASC` 对齐） */
export function vaultWeightAll(): WeightVaultRow[] {
  return readJson<WeightVaultRow[]>(MOD, FILE, [])
    .slice()
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
}

/** 整表覆盖写（原子写由 jsonStore 负责） */
export function vaultWeightSave(rows: WeightVaultRow[]): void {
  writeJson(MOD, FILE, rows)
}
