import QRCode from 'qrcode'

/**
 * 二维码生成（主进程）：渲染层是 sandbox 环境，没有 Node Buffer，
 * 而 qrcode 的 toDataURL 依赖 pngjs/Buffer —— 所以放在主进程生成，IPC 回传 dataURL。
 */
export async function toQrDataUrl(text: string, width = 240): Promise<string> {
  return QRCode.toDataURL(text, { width, margin: 1, errorCorrectionLevel: 'M' })
}
