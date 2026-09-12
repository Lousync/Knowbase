import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'

/**
 * 语义向量库（knowledge-index-design §7）—— 落 <vault>/.knowbase/semantics/。
 *
 *   chunks.json  结构化元数据（人可读）：{ schemaVersion, model, dim, vaultPath, generatedAt,
 *                  pages: { [pageId]: { mtimeMs, chunks: [{key, idx, title, offset, hash}] } } }
 *   vectors.bin  定长记录 Float32[dim] × N，offset 按 chunk 顺序排列（ADR-2：二进制而非 JSON，
 *                体积 1/4、免 parse、追加写契合增量）
 *
 * root 由调用方注入（kbModulePath/模块 'semantics' 同布局），纯 fs 不 import electron——node 冒烟可跑。
 * 检索 = 内存暴力余弦（ADR-1）：万块×1024 维 Float32 ≈ 40MB，subarray 点积 <10ms，
 * 规模到十万块再议 ANN（升级口留在这里）。
 */

const SCHEMA_VERSION = 1

export interface SemanticChunkMeta {
  key: string
  idx: number
  /** 块所属页标题（快照，供结果展示） */
  title: string
  /** vectors.bin 内记录下标（× dim × 4 = 字节偏移） */
  offset: number
  hash: string
}

export interface SemanticPageEntry {
  /** 页面 mtime 快照：变了才重切（增量检测第一层） */
  mtimeMs: number
  chunks: SemanticChunkMeta[]
}

interface SemanticIndexFile {
  schemaVersion: number
  /** 嵌入模型标识（换模型 = 全量重建，维度不混） */
  model: string
  dim: number
  vaultPath: string | null
  generatedAt: string
  pages: Record<string, SemanticPageEntry>
}

export interface LoadedSemantics {
  file: SemanticIndexFile
  /** vectors.bin 全量字节（offset×dim×4 取记录） */
  data: Buffer | null
}

// ===== 进程内 memo（对齐 getKnowledgeTextIndex 的 memo 模式）=====

let memo: { root: string; mtimeMs: number; loaded: LoadedSemantics } | null = null

export function loadSemantics(root: string): LoadedSemantics {
  const metaPath = join(root, 'semantics', 'chunks.json')
  const binPath = join(root, 'semantics', 'vectors.bin')
  const mtimeMs = existsSync(metaPath) ? statSync(metaPath).mtimeMs : 0
  if (memo && memo.root === root && memo.mtimeMs === mtimeMs) return memo.loaded
  let file: SemanticIndexFile
  if (mtimeMs > 0) {
    try {
      file = JSON.parse(readFileSync(metaPath, 'utf-8')) as SemanticIndexFile
    } catch {
      file = emptyFile()
    }
  } else {
    file = emptyFile()
  }
  if (file.schemaVersion !== SCHEMA_VERSION || !file.pages || typeof file.pages !== 'object') file = emptyFile()
  const data = existsSync(binPath) ? readFileSync(binPath) : null
  const loaded: LoadedSemantics = { file, data }
  memo = { root, mtimeMs, loaded }
  return loaded
}

function emptyFile(): SemanticIndexFile {
  return { schemaVersion: SCHEMA_VERSION, model: '', dim: 0, vaultPath: null, generatedAt: '', pages: {} }
}

/** 丢弃进程内缓存（invalidateKnowledgeIndex 钩子调用；向量不删，下次 ensure 走 diff 重建） */
export function clearSemanticsMemo(): void {
  memo = null
}

export function semanticIndexExists(root: string): boolean {
  return existsSync(join(root, 'semantics', 'chunks.json'))
}

/** 嵌入模型/维度与现库不匹配 = 旧库整体作废（ADR：不混维度） */
export function isModelMismatch(root: string, model: string, dim: number): boolean {
  const loaded = loadSemantics(root)
  return !!loaded.file.model && (loaded.file.model !== model || loaded.file.dim !== dim)
}

/** 整库原子写（tmp + rename，对齐 jsonStore 策略）；调用方负责先 clearSemanticsMemo */
export function writeSemantics(
  root: string,
  file: Omit<SemanticIndexFile, 'schemaVersion' | 'generatedAt'>,
  vectors: Float32Array,
): void {
  const dir = join(root, 'semantics')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const payload: SemanticIndexFile = {
    schemaVersion: SCHEMA_VERSION,
    model: file.model,
    dim: file.dim,
    vaultPath: file.vaultPath,
    generatedAt: new Date().toISOString(),
    pages: file.pages,
  }
  const metaTmp = join(dir, 'chunks.json.tmp')
  writeFileSync(metaTmp, JSON.stringify(payload), 'utf-8')
  const binTmp = join(dir, 'vectors.bin.tmp')
  const buf = Buffer.from(vectors.buffer, vectors.byteOffset, vectors.byteLength)
  writeFileSync(binTmp, buf)
  const metaPath = join(dir, 'chunks.json')
  const binPath = join(dir, 'vectors.bin')
  renameSync(metaTmp, metaPath)
  try {
    renameSync(binTmp, binPath)
  } catch {
    if (existsSync(binPath)) unlinkSync(binPath)
    renameSync(binTmp, binPath)
  }
}

export function removeSemanticsFiles(root: string): void {
  clearSemanticsMemo()
  for (const name of ['chunks.json', 'vectors.bin']) {
    const p = join(root, 'semantics', name)
    if (existsSync(p)) unlinkSync(p)
  }
}

// ===== 检索 =====

export interface SemanticHit {
  key: string
  score: number
}

/** 单记录余弦（向量为归一化或原始均可——两侧同源，比值等价余弦） */
function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / Math.sqrt(na * nb)
}

/** 暴力余弦 top-K（queryVec 与库同维度；库空返回 []） */
export function cosineTopK(root: string, queryVec: Float32Array, k: number): SemanticHit[] {
  const { file, data } = loadSemantics(root)
  const dim = file.dim
  if (!dim || !data || queryVec.length !== dim) return []
  const out: SemanticHit[] = []
  for (const pageId of Object.keys(file.pages)) {
    for (const c of file.pages[pageId].chunks) {
      const rec = new Float32Array(data.buffer, data.byteOffset + c.offset * dim * 4, dim)
      out.push({ key: c.key, score: cosine(queryVec, rec) })
    }
  }
  out.sort((a, b) => b.score - a.score)
  return out.slice(0, Math.max(1, k))
}

/** key → 元数据反查（结果聚合用） */
export function findChunkByKey(root: string, key: string): { pageId: string; meta: SemanticChunkMeta } | null {
  const { file } = loadSemantics(root)
  for (const pageId of Object.keys(file.pages)) {
    const meta = file.pages[pageId].chunks.find((c) => c.key === key)
    if (meta) return { pageId, meta }
  }
  return null
}
