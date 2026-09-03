import { createWriteStream, type WriteStream } from 'fs'
import { join, basename } from 'path'
import type { IncomingMessage } from 'http'
import { randomUUID } from 'crypto'
import { getInboxDir } from './paths'
import { isValidFileName } from './files'

/**
 * multipart/form-data 流式解析（零依赖实现）。
 *
 * 约束：
 *  - 单文件上限 500MB，超出即 413 并丢弃请求
 *  - 文件内容流式写盘，不整块读进内存（内存占用 ≈ 一个 chunk 大小）
 *  - 只提取「文件类」part（带 filename 的），其余字段忽略
 */

export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export interface UploadedFile {
  originalName: string
  savedName: string
  size: number
  path: string
}

const CRLF = Buffer.from('\r\n')
const CRLFCRLF = Buffer.from('\r\n\r\n')

function sanitizeFileName(raw: string): string {
  const base = basename(raw).replace(/[\\/:*?"<>|]/g, '_').trim()
  if (isValidFileName(base)) return base
  return `file-${randomUUID().slice(0, 8)}`
}

export async function parseUpload(req: IncomingMessage, maxBytes = MAX_UPLOAD_BYTES): Promise<UploadedFile[]> {
  const contentType = req.headers['content-type'] || ''
  const bm = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType)
  if (!bm) throw new HttpError(400, '缺少 multipart boundary')
  const boundary = bm[1] || bm[2] || ''
  if (!boundary) throw new HttpError(400, 'boundary 为空')
  const delim = Buffer.from(`--${boundary}`)

  const uploaded: UploadedFile[] = []
  let fatal: Error | null = null

  await new Promise<void>((resolve, reject) => {
    let buf = Buffer.alloc(0)
    let state: 'preamble' | 'header' | 'body' = 'preamble'
    let current: {
      fileName: string | null
      savedName: string
      size: number
      stream: WriteStream | null
      path: string | null
    } | null = null
    let pendingStreams = 0
    let resolved = false
    let ended = false

    const fail = (status: number, msg: string): void => {
      if (!fatal) fatal = new HttpError(status, msg)
      req.destroy()
    }

    const tryFinish = (): void => {
      if (resolved || !ended) return
      if (pendingStreams > 0) return
      resolved = true
      if (fatal) reject(fatal)
      else resolve()
    }

    const closeCurrent = (): void => {
      if (!current) return
      const c = current
      current = null
      if (c.fileName && c.path && c.stream) {
        uploaded.push({ originalName: c.fileName, savedName: c.savedName, size: c.size, path: c.path })
        pendingStreams += 1
        c.stream.end(() => {
          pendingStreams -= 1
          tryFinish()
        })
      } else if (c.stream) {
        c.stream.destroy()
      }
    }

    const writeChunk = (chunk: Buffer): void => {
      const c = current
      if (!c || !c.fileName) return
      c.size += chunk.length
      if (c.size > maxBytes) {
        fail(413, '文件超过大小上限')
        return
      }
      if (!c.stream) {
        c.savedName = sanitizeFileName(c.fileName)
        c.path = join(getInboxDir(), `${Date.now()}-${c.savedName}`)
        c.stream = createWriteStream(c.path)
      }
      c.stream.write(chunk)
    }

    const processBuf = (): void => {
      for (;;) {
        if (fatal) return
        if (state === 'preamble') {
          const idx = buf.indexOf(delim)
          if (idx === -1) { buf = Buffer.alloc(0); return }
          buf = buf.subarray(idx + delim.length)
          state = 'header'
          continue
        }
        if (state === 'header') {
          const idx = buf.indexOf(CRLFCRLF)
          if (idx === -1) {
            if (buf.length > 64 * 1024) { fail(400, 'multipart header 过长'); return }
            return
          }
          const headerRaw = buf.subarray(0, idx).toString('utf-8')
          buf = buf.subarray(idx + 4)
          const cd = /content-disposition:\s*form-data;\s*name="([^"]*)"(?:;\s*filename="([^"]*)")?/i.exec(headerRaw)
          current = {
            fileName: cd && cd[2] ? cd[2] : null,
            savedName: '',
            size: 0,
            stream: null,
            path: null,
          }
          state = 'body'
          continue
        }
        // state === 'body'
        const idx = buf.indexOf(delim)
        if (idx === -1) {
          const keep = delim.length + 4
          if (buf.length > keep) {
            const writable = buf.length - keep
            writeChunk(buf.subarray(0, writable))
            if (fatal) return
            buf = buf.subarray(writable)
          }
          return
        }
        let bodyEnd = idx
        if (bodyEnd >= 2 && buf[bodyEnd - 2] === 0x0d && buf[bodyEnd - 1] === 0x0a) bodyEnd -= 2
        writeChunk(buf.subarray(0, bodyEnd))
        if (fatal) return
        closeCurrent()
        buf = buf.subarray(idx + delim.length)
        if (buf[0] === 0x2d && buf[1] === 0x2d) { // '--' 结束标记
          ended = true
          tryFinish()
          return
        }
        if (buf[0] === 0x0d && buf[1] === 0x0a) {
          buf = buf.subarray(2)
          state = 'header'
          continue
        }
        fail(400, 'multipart 格式错误')
        return
      }
    }

    req.on('data', (chunk: Buffer) => {
      if (fatal) return
      buf = Buffer.concat([buf, chunk])
      try {
        processBuf()
      } catch (e) {
        fatal = e instanceof Error ? e : new Error(String(e))
        req.destroy()
      }
    })
    req.on('end', () => {
      ended = true
      try {
        processBuf()
      } catch (e) {
        if (!fatal) fatal = e instanceof Error ? e : new Error(String(e))
      }
      if (!fatal) closeCurrent()
      tryFinish()
    })
    req.on('error', (e) => {
      if (!fatal) fatal = e
      tryFinish()
    })
  })

  return uploaded
}
