#!/usr/bin/env node
/**
 * 插件签名工具（R7 V3-4，作者侧）：ed25519 密钥生成 + 对插件目录签名。
 *
 * 用法：
 *   node scripts/sign-plugin.mjs keygen [--out keys/]            生成 ed25519 密钥对（私钥勿入库！）
 *   node scripts/sign-plugin.mjs sign <pluginDir> --key <pem> [--keyId kb-official-2026]
 *       读取 plugin.json + entry 文件 → 计算 canonical → 签名 → 把 signing 字段写回 plugin.json
 *
 * 公钥发布：把公钥(PEM)贴到应用 设置→高级→pluginTrustedKeys（keyId=公钥），或固化进内置 keyring。
 * 签名规范：canonical = sha256(stableStringify(manifest 剔除 signing)) + '\n' + sha256(entry bytes 或 '-')
 *   （signing 字段写入会改写 plugin.json，故 canonical 基于剔除 signing 的稳定序列化——
 *    与 electron/lib/pluginSigning.ts 的 stableManifestString 必须同一实现，改动需同步）
 */
import { generateKeyPairSync, createHash, sign as cryptoSign } from 'crypto'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, resolve } from 'path'

const [, , cmd, ...rest] = process.argv

function argOf(name) {
  const i = rest.indexOf(name)
  return i >= 0 ? rest[i + 1] : undefined
}

function keygen() {
  const outDir = argOf('--out') || 'keys'
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  mkdirSync(outDir, { recursive: true })
  const pubPath = join(outDir, 'plugin-signing.pub.pem')
  const privPath = join(outDir, 'plugin-signing.priv.pem')
  writeFileSync(pubPath, publicKey.export({ type: 'spki', format: 'pem' }), { mode: 0o644 })
  writeFileSync(privPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
  console.log('已生成密钥对：')
  console.log(`  公钥(发布/内置 keyring): ${pubPath}`)
  console.log(`  私钥(签名用,勿入库！):   ${privPath}`)
}

function signPlugin() {
  const dir = resolve(argOf('--key') ? rest[0] : rest[0] ?? '')
  const keyPath = argOf('--key')
  const keyId = argOf('--keyId') || 'kb-official-2026'
  if (!dir || !keyPath) {
    console.error('用法: node scripts/sign-plugin.mjs sign <pluginDir> --key <privPem> [--keyId xxx]')
    process.exit(1)
  }
  const manifestPath = join(dir, 'plugin.json')
  if (!existsSync(manifestPath)) { console.error('plugin.json 不存在'); process.exit(1) }
  const manifestBytes = readFileSync(manifestPath)
  const manifest = JSON.parse(manifestBytes.toString('utf-8'))
  const entryBytes = manifest.entry ? readFileSync(join(dir, manifest.entry)) : null

  // canonical 基于剔除 signing 的稳定序列化（与 pluginSigning.ts stableManifestString 同一实现）
  const stable = (v) => {
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']'
    if (v && typeof v === 'object') {
      const keys = Object.keys(v).filter((k) => k !== 'signing').sort()
      return '{' + keys.map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}'
    }
    return JSON.stringify(v)
  }
  const canonical = `${createHash('sha256').update(stable(manifest), 'utf-8').digest('hex')}\n${
    entryBytes ? createHash('sha256').update(entryBytes).digest('hex') : '-'
  }`
  const sig = cryptoSign(null, Buffer.from(canonical, 'utf-8'), readFileSync(keyPath)).toString('base64')

  manifest.signing = { algo: 'ed25519', keyId, sig }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  console.log(`已签名: ${manifest.id}@${manifest.version} (keyId=${keyId})`)
  console.log('提醒: 把对应公钥配置到应用 pluginTrustedKeys 或固化内置 keyring')
}

if (cmd === 'keygen') keygen()
else if (cmd === 'sign') signPlugin()
else {
  console.error('用法:\n  node scripts/sign-plugin.mjs keygen [--out keys/]\n  node scripts/sign-plugin.mjs sign <pluginDir> --key <privPem> [--keyId xxx]')
  process.exit(1)
}
