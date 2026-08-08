/**
 * 极简 ZIP 读写（无第三方依赖，Node 内置 zlib）
 * 支持 deflate 压缩条目；读取时兼容 stored/deflate 两种压缩方式。
 */
import { deflateRawSync, inflateRawSync } from 'zlib'

export interface ZipEntry {
  path: string
  data: Buffer
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf: Buffer): number {
  let c = 0xFFFFFFFF
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8)
  }
  return (c ^ 0xFFFFFFFF) >>> 0
}

function u16(v: number): Buffer {
  const b = Buffer.alloc(2)
  b.writeUInt16LE(v & 0xFFFF, 0)
  return b
}

function u32(v: number): Buffer {
  const b = Buffer.alloc(4)
  b.writeUInt32LE(v >>> 0, 0)
  return b
}

/** 打包为 zip（deflate 压缩） */
export function zipBuffer(entries: ZipEntry[]): Buffer {
  const chunks: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0

  for (const e of entries) {
    const name = Buffer.from(e.path, 'utf-8')
    const compressed = deflateRawSync(e.data)
    const crc = crc32(e.data)
    const local = Buffer.concat([
      Buffer.from('PK\x03\x04', 'binary'),
      u16(20), // version needed
      u16(0x0800), // flags: UTF-8 names
      u16(8), // deflate
      u16(0), u16(0),
      u32(crc),
      u32(compressed.length),
      u32(e.data.length),
      u16(name.length), u16(0),
      name,
    ])
    chunks.push(local, compressed)
    central.push(Buffer.concat([
      Buffer.from('PK\x01\x02', 'binary'),
      u16(20), u16(20),
      u16(0x0800),
      u16(8),
      u16(0), u16(0),
      u32(crc),
      u32(compressed.length),
      u32(e.data.length),
      u16(name.length), u16(0), u16(0), u16(0), u16(0),
      u32(0),
      u32(offset),
      name,
    ]))
    offset += local.length + compressed.length
  }

  const centralBuf = Buffer.concat(central)
  const eocd = Buffer.concat([
    Buffer.from('PK\x05\x06', 'binary'),
    u16(0), u16(0),
    u16(entries.length), u16(entries.length),
    u32(centralBuf.length),
    u32(offset),
    u16(0),
  ])
  return Buffer.concat([...chunks, centralBuf, eocd])
}

/** 解包 zip 到 Map<path, Buffer> */
export function unzipBuffer(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>()
  // 从尾部找 EOCD
  let eocd = -1
  const tail = buf.length > 65557 ? buf.length - 65557 : 0
  for (let i = buf.length - 22; i >= tail; i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('无效的 ZIP 文件')

  const entryCount = buf.readUInt16LE(eocd + 10)
  let cdOffset = buf.readUInt32LE(eocd + 16)
  for (let i = 0; i < entryCount; i++) {
    const sig = buf.readUInt32LE(cdOffset)
    if (sig !== 0x02014b50) break
    const method = buf.readUInt16LE(cdOffset + 10)
    const compSize = buf.readUInt32LE(cdOffset + 20)
    const uncompSize = buf.readUInt32LE(cdOffset + 24)
    const nameLen = buf.readUInt16LE(cdOffset + 28)
    const extraLen = buf.readUInt16LE(cdOffset + 30)
    const commentLen = buf.readUInt16LE(cdOffset + 32)
    const localOffset = buf.readUInt32LE(cdOffset + 42)
    const name = buf.toString('utf-8', cdOffset + 46, cdOffset + 46 + nameLen)
    if (name.endsWith('/')) { // directory
      cdOffset += 46 + nameLen + extraLen + commentLen
      continue
    }
    const lNameLen = buf.readUInt16LE(localOffset + 26)
    const lExtraLen = buf.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + lNameLen + lExtraLen
    const raw = buf.subarray(dataStart, dataStart + compSize)
    const data = method === 0 ? Buffer.from(raw) : method === 8 ? inflateRawSync(raw) : Buffer.from(raw)
    if (data.length === uncompSize) out.set(name, data)
    cdOffset += 46 + nameLen + extraLen + commentLen
  }
  return out
}
