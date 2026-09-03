/**
 * qrcode 最小类型声明（主进程专用）。
 * 依赖通过 npm pack 手动落入 node_modules（本机 safe-delete 拦截 npm install 的 reify 清理），
 * 包本身不携带类型，此处补齐 lanShare 实际用到的 API。
 */
declare module 'qrcode' {
  interface QRCodeToDataURLOptions {
    width?: number
    margin?: number
    errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H'
  }
  function toDataURL(text: string, options?: QRCodeToDataURLOptions): Promise<string>
  const QRCode: { toDataURL: typeof toDataURL }
  export default QRCode
}
