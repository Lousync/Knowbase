// Shared image preprocessing: HEIC/HEIF conversion → data URL.
// Used by inline markdown image insertion (blog / knowledge editors).
// The moments module keeps its own local copy (which additionally generates thumbnails).

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/** 判断是否为 HEIC/HEIF：优先按扩展名/MIME，再按文件头特征兜底 */
export const HEIC_EXT_RE = /\.(heic|heif)$/i

export async function detectHeic(file: File): Promise<boolean> {
  if (/^image\/hei[cf]$/i.test(file.type || '') || HEIC_EXT_RE.test(file.name)) return true
  try {
    const { isHeic } = await import('heic-to/csp')
    return await isHeic(file)
  } catch {
    return false
  }
}

/** 用 heic-to（libheif）把 HEIC/HEIF 本地转为 JPEG，Chromium 本身无法解码 HEIC */
export async function convertHeicToJpeg(file: File): Promise<string> {
  const { heicTo } = await import('heic-to/csp')
  const jpeg = await heicTo({ blob: file, type: 'image/jpeg', quality: 0.92 })
  return blobToDataUrl(jpeg)
}

export interface PreparedImageDataUrl {
  name: string
  mime: string
  dataUrl: string
}

/** 预处理图片为 data URL（HEIC 转 JPEG 并同步文件名/MIME），不含缩略图 */
export async function prepareImageDataUrl(f: File): Promise<PreparedImageDataUrl> {
  const heic = await detectHeic(f)
  let dataUrl = await readFileAsDataUrl(f)
  if (heic) {
    try {
      dataUrl = await convertHeicToJpeg(f)
    } catch {
      throw new Error(`HEIC 照片「${f.name}」转换失败，请改用 JPEG/PNG 后重试`)
    }
  }
  return {
    name: heic ? f.name.replace(HEIC_EXT_RE, '.jpg') : f.name,
    mime: heic ? 'image/jpeg' : (f.type || 'image/*'),
    dataUrl,
  }
}
