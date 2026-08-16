// Inline markdown image insertion for Monaco-based editors (blog & knowledge).
// Uploads the image into the unified attachment store, then inserts `![name](attachment://id/)` at the cursor.

import type * as Monaco from 'monaco-editor'
import { uploadAttachments } from './ipc'
import { prepareImageDataUrl } from './image'
import type { AttachmentMeta } from '../types'

/** Owner types registered in the attachment cleanup map (attachmentRepo.ts). */
export const IMAGE_OWNER = {
  blog: 'blog_entry',
  knowledge: 'knowledge_page',
} as const

export const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|heic|heif)$/i

/** Whether a File looks like an image (by MIME or extension). */
export function isImageFile(file: File): boolean {
  if (file.type && file.type.startsWith('image/')) return true
  return IMAGE_EXT_RE.test(file.name)
}

/** Upload a single image File → attachment meta (HEIC auto-converted to JPEG). */
export async function uploadImageFile(file: File, ownerType: string, ownerId: string): Promise<AttachmentMeta> {
  const prepared = await prepareImageDataUrl(file)
  const records = await uploadAttachments({ ownerType, ownerId, files: [prepared] })
  return records[0]
}

/** Build the markdown image snippet for an attachment. */
export function imageMarkdown(meta: AttachmentMeta): string {
  const alt = (meta.name || 'image').replace(/[[\]]/g, '')
  return `![${alt}](${meta.url})`
}

/** Insert `![name](url)` at the cursor (replacing any selection), then move caret past it. */
export function insertImageAtCursor(editor: Monaco.editor.IStandaloneCodeEditor, meta: AttachmentMeta): void {
  const md = imageMarkdown(meta)
  const selection = editor.getSelection()
  if (!selection) return
  editor.executeEdits('insert-image', [{ range: selection, text: md, forceMoveMarkers: true }])
  editor.setPosition({ lineNumber: selection.startLineNumber, column: selection.startColumn + md.length })
  editor.focus()
}
