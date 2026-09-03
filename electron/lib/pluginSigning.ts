/**
 * 插件包签名（R7 V3-4，ADR-9）：ed25519 + 信任公钥 keyring。
 *
 * canonical 规范串（确定且与包内容绑定）：
 *   manifestSha256Hex + '\n' + entrySha256Hex(或 '-'，无 entry 时)
 * signing.sig = ed25519 签名(canonical utf-8)，keyId 标注用哪把公钥验。
 *
 * 策略（红线 6 / ADR-9）：
 *   - 市场下载的包：settings `pluginRequireSignature` 开启时必须有效签名；
 *     关闭（默认，作者发签名版前的过渡期）则放行但审计记录 unsigned。
 *   - 本地显式安装 / 内置示例：不强制（开发与作者自用），但带 signing 时仍验证。
 *
 * 纯逻辑（node:crypto），可 node 冒烟。
 */
import { createHash, verify as cryptoVerify } from 'crypto'

export interface SigningInfo {
  algo: string
  keyId: string
  sig: string
}

/** canonical 规范串：stable-manifest(剔除 signing) sha256 + '\n' + entry sha256（无 entry 用 '-'） */
export function signingCanonical(manifestBytes: Buffer, entryBytes: Buffer | null): string {
  const m = createHash('sha256').update(stableManifestString(manifestBytes), 'utf-8').digest('hex')
  const e = entryBytes ? createHash('sha256').update(entryBytes).digest('hex') : '-'
  return `${m}\n${e}`
}

/**
 * 稳定序列化 manifest（剔除 signing 字段）：
 * signing 字段写在 plugin.json 里，签名动作本身会改写该文件——若 canonical 用原始
 * bytes，签名后文件已变、验签永远失败。故剔除 signing 后做键递归排序的稳定序列化
 * （数组保序），同一份 manifest 无论格式化/键序差异 canonical 一致。
 * ⚠️ 与 scripts/sign-plugin.mjs 的 stableStringify 必须保持同一实现（两侧内联，改动需同步）。
 */
function stableManifestString(manifestBytes: Buffer): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(manifestBytes.toString('utf-8'))
  } catch {
    // 理论不会发生（validateManifest 在验签前已校验 JSON）；退回原始 bytes 保持可验证性
    return manifestBytes.toString('utf-8')
  }
  const stable = (v: unknown): string => {
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']'
    if (v && typeof v === 'object') {
      const obj = v as Record<string, unknown>
      const keys = Object.keys(obj).filter((k) => k !== 'signing').sort()
      return '{' + keys.map((k) => JSON.stringify(k) + ':' + stable(obj[k])).join(',') + '}'
    }
    return JSON.stringify(v)
  }
  return stable(parsed)
}

/**
 * 验签：canonical 用 keyring 中任一公钥验通过即 ok。
 * @param signing    plugin.json.signing 字段（已过结构校验）
 * @param keyring    keyId → 公钥(PEM 或 DER base64)；keyId 未命中视为不可信
 * @returns null=通过；否则返回拒装原因文案
 */
export function verifyPluginSignature(
  manifestBytes: Buffer,
  entryBytes: Buffer | null,
  signing: SigningInfo | undefined,
  keyring: Record<string, string>,
): string | null {
  if (!signing) return '插件包未签名（市场包需要有效签名，或使用本地安装）'
  const canonical = signingCanonical(manifestBytes, entryBytes)
  const pub = keyring[signing.keyId]
  if (!pub) return `签名 keyId 未受信: ${signing.keyId}`
  const sigBuf = Buffer.from(signing.sig, 'base64')
  let ok = false
  try {
    ok = cryptoVerify(null, Buffer.from(canonical, 'utf-8'), pub, sigBuf)
  } catch {
    ok = false
  }
  return ok ? null : '插件包签名校验失败（内容可能被篡改或签名密钥不匹配）'
}

/** keyring 来源合并：内置(暂空占位) + settings pluginTrustedKeys（用户可贴公钥） */
export function buildKeyring(trustedKeysSetting: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  // 内置官方公钥：作者首次发布签名版后在此固化（keyId → PEM/base64 公钥）
  const builtin: Record<string, string> = {}
  Object.assign(out, builtin)
  if (typeof trustedKeysSetting === 'string' && trustedKeysSetting.trim()) {
    // 约定格式：JSON {"keyId":"pubkey"}，或简单 keyId=pubkey 逗号分隔
    const s = trustedKeysSetting.trim()
    if (s.startsWith('{')) {
      try {
        const parsed = JSON.parse(s) as Record<string, string>
        for (const [k, v] of Object.entries(parsed)) if (k && typeof v === 'string') out[k] = v
      } catch { /* 格式错误忽略，走简单解析 */ }
    } else {
      for (const pair of s.split(',')) {
        const idx = pair.indexOf('=')
        if (idx > 0) out[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim()
      }
    }
  }
  return out
}
