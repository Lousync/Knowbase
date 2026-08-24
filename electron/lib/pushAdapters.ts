import { createHmac } from 'crypto'

/**
 * 推送平台适配器 —— 把统一的 { title, contentMd } 转成各平台的 HTTP 请求。
 * 新增平台只需在 ADAPTERS 加一个实现。
 */

export type SupervisePlatform = 'serverchan' | 'wecom' | 'dingtalk' | 'custom'

export interface SupervisePushConfig {
  platform: SupervisePlatform
  /** serverchan 存 SendKey，其余存完整 webhook 地址 */
  webhookUrl: string
  /** 仅钉钉加签用 */
  secret: string
}

export interface PushPayload {
  title: string
  contentMd: string
}

export interface AdaptedRequest {
  url: string
  body: string
  contentType?: string
}

/** 截断到指定 UTF-8 字节数，防止超出平台消息上限（企微 markdown ≤4096 字节） */
function truncateUtf8(text: string, maxBytes: number): string {
  const buf = Buffer.from(text, 'utf-8')
  if (buf.length <= maxBytes) return text
  return buf.subarray(0, maxBytes).toString('utf-8')
}

function formEncode(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')
}

const ADAPTERS: Record<SupervisePlatform, (p: PushPayload, cfg: SupervisePushConfig) => AdaptedRequest> = {
  // Server酱 Turbo：https://sctapi.ftqq.com/{SendKey}.send，title + desp(markdown)
  serverchan: (p, cfg) => ({
    url: `https://sctapi.ftqq.com/${encodeURIComponent(cfg.webhookUrl.trim())}.send`,
    body: formEncode({ title: truncateUtf8(p.title, 256), desp: p.contentMd }),
    contentType: 'application/x-www-form-urlencoded',
  }),

  // 企业微信群机器人：markdown 消息无独立标题字段，标题并入正文
  wecom: p => ({
    url: '',
    body: JSON.stringify({
      msgtype: 'markdown',
      markdown: { content: truncateUtf8(`**${p.title}**\n${p.contentMd}`, 4000) },
    }),
    contentType: 'application/json',
  }),

  // 钉钉群机器人：支持加签 secret → timestamp&sign(HMAC-SHA256)
  dingtalk: (p, cfg) => {
    let url = cfg.webhookUrl.trim()
    if (cfg.secret) {
      const ts = Date.now()
      const stringToSign = `${ts}\n${cfg.secret}`
      const sign = createHmac('sha256', cfg.secret).update(stringToSign).digest('base64')
      const sep = url.includes('?') ? '&' : '?'
      url = `${url}${sep}timestamp=${ts}&sign=${encodeURIComponent(sign)}`
    }
    return {
      url,
      body: JSON.stringify({
        msgtype: 'markdown',
        markdown: { title: truncateUtf8(p.title, 128), text: truncateUtf8(p.contentMd, 18000) },
      }),
      contentType: 'application/json',
    }
  },

  // 自定义 webhook：POST 统一 JSON 结构
  custom: (p, cfg) => ({
    url: cfg.webhookUrl.trim(),
    body: JSON.stringify({ title: p.title, content: p.contentMd, timestamp: new Date().toISOString() }),
    contentType: 'application/json',
  }),
}

/** 组装请求；wecom/custom 的地址存在 webhookUrl 里 */
export function adaptPush(payload: PushPayload, cfg: SupervisePushConfig): AdaptedRequest {
  const req = ADAPTERS[cfg.platform](payload, cfg)
  if (!req.url) req.url = cfg.platform === 'wecom' ? cfg.webhookUrl.trim() : ''
  return req
}
