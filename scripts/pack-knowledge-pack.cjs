// 知识包插件打包工具：把插件目录打成 zip（复用 electron/lib/zip.ts 的极简 zip 逻辑）
// 用法: node scripts/pack-knowledge-pack.cjs <插件目录> [输出zip路径]
// 保证: 正斜杠路径 + UTF-8 文件名 + deflate，与知识包导入器（unzipBuffer）完全兼容
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const root = process.argv[2]
if (!root || !fs.existsSync(path.join(root, 'plugin.json'))) {
  console.error('用法: node pack-knowledge-pack.cjs <插件目录> [输出zip路径]\n插件目录需含 plugin.json')
  process.exit(1)
}
const outZip = process.argv[3] || path.join(path.dirname(root), path.basename(root) + '.zip')

// ---- 极简 zip（复制自 electron/lib/zip.ts 的 zipBuffer）----
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0 } return t })()
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0 }
function u16(v) { const b = Buffer.alloc(2); b.writeUInt16LE(v & 0xFFFF, 0); return b }
function u32(v) { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0, 0); return b }
function zipBuffer(entries) {
  const chunks = [], central = []; let offset = 0
  for (const e of entries) {
    const name = Buffer.from(e.path, 'utf-8')
    const compressed = zlib.deflateRawSync(e.data)
    const crc = crc32(e.data)
    const local = Buffer.concat([Buffer.from('PK\x03\x04', 'binary'), u16(20), u16(0x0800), u16(8), u16(0), u16(0), u32(crc), u32(compressed.length), u32(e.data.length), u16(name.length), u16(0), name])
    chunks.push(local, compressed)
    central.push(Buffer.concat([Buffer.from('PK\x01\x02', 'binary'), u16(20), u16(20), u16(0x0800), u16(8), u16(0), u16(0), u32(crc), u32(compressed.length), u32(e.data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name]))
    offset += local.length + compressed.length
  }
  const centralBuf = Buffer.concat(central)
  return Buffer.concat([...chunks, centralBuf, Buffer.concat([Buffer.from('PK\x05\x06', 'binary'), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(centralBuf.length), u32(offset), u16(0)])])
}

// ---- 收集文件（跳过隐藏文件）----
function collect(dir, base, out) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('.')) continue
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) collect(full, base, out)
    else if (ent.isFile()) {
      const rel = path.relative(base, full).split(path.sep).join('/')
      out.push({ path: rel, data: fs.readFileSync(full) })
    }
  }
}
const entries = []
collect(root, root, entries)
if (entries.length === 0) { console.error('插件目录为空'); process.exit(1) }

const buf = zipBuffer(entries)
fs.writeFileSync(outZip, buf)
const sizeKB = (buf.length / 1024).toFixed(1)
console.log(`✅ 打包完成: ${entries.length} 个文件 → ${outZip} (${sizeKB} KB)`)
console.log('   根文件:', entries.filter(e => !e.path.includes('/')).map(e => e.path).join(', '))
