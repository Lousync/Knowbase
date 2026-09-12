import { createHash } from 'crypto'

/**
 * 知识页分块器（knowledge-index-design §5，纯函数可冒烟）。
 *
 * 切分依据：ATX 标题层级（#/##/###…）——尊重文档结构；单块超过 MAX_CHARS 的
 * 长段落用固定窗口二级切分（WINDOW_CHARS / OVERLAP_CHARS）。
 * 块标识 chunkKey = sha1(pageId | idx | 块正文)：内容不变 → key 不变 → 向量复用（ADR-4），
 * 一个键同时解决「变了没」和「算过没」。
 */

/** 单块字符上限（≈600 token 中英混合经验值；设计目标 300-800 token） */
export const MAX_CHARS = 1200
/** 二级固定窗口长度 */
export const WINDOW_CHARS = 1000
/** 二级窗口重叠 */
export const OVERLAP_CHARS = 100

const HEADING_RE = /^#{1,2}\s+.+$/

export interface PageChunk {
  /** sha1(pageId | idx | text) */
  key: string
  /** 块序（页内） */
  idx: number
  /** 块正文（首块前缀拼「页面标题 /」，缓解无标题块检索偏弱） */
  text: string
  /** 块正文 sha1（供增量对账/诊断） */
  hash: string
}

/** 按标题层级切块：#/## 起新块，### 及更深保留在块内；无标题的整页 = 单块（超长走二级窗口） */
export function chunkPageText(pageId: string, title: string, rawMd: string): PageChunk[] {
  const lines = String(rawMd ?? '').split('\n')
  const sections: string[] = []
  let buf: string[] = []
  const flush = () => {
    const text = buf.join('\n').trim()
    if (text) sections.push(text)
    buf = []
  }
  for (const line of lines) {
    if (HEADING_RE.test(line)) {
      flush()
      buf.push(line)
    } else {
      buf.push(line)
    }
  }
  flush()

  const titlePrefix = title.trim() ? `${title.trim()} / ` : ''
  const out: PageChunk[] = []
  for (const section of sections) {
    if (section.length <= MAX_CHARS) {
      pushChunk(out, pageId, titlePrefix + section)
      continue
    }
    // 二级固定窗口：首块不带前缀算入窗口，前缀只影响首块（保证短块场景标题参与检索）
    for (let i = 0, win = 0; i < section.length; i += WINDOW_CHARS - OVERLAP_CHARS, win++) {
      const text = section.slice(i, i + WINDOW_CHARS)
      if (!text.trim()) break
      pushChunk(out, pageId, (win === 0 ? titlePrefix : '') + text)
      if (i + WINDOW_CHARS >= section.length) break
    }
  }
  // 整页空正文：至少给一个「标题块」，保证页面可被语义召回
  if (out.length === 0 && title.trim()) pushChunk(out, pageId, title.trim())
  return out
}

function pushChunk(out: PageChunk[], pageId: string, text: string): void {
  const hash = sha1(text)
  out.push({ key: sha1(`${pageId}|${out.length}|${hash}`), idx: out.length, text, hash })
}

export function sha1(s: string): string {
  return createHash('sha1').update(s, 'utf-8').digest('hex')
}
