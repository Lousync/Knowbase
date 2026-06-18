import { useState, useCallback } from 'react'
import { FileText } from 'lucide-react'

interface ImportFile {
  title: string
  content: string
  fileType: string
}

interface ImportPdfFile {
  title: string
  base64: string
  fileName: string
}

interface Props {
  onImport: (files: ImportFile[]) => Promise<void>
  onImportPdf?: (files: ImportPdfFile[]) => Promise<void>
  children: React.ReactNode
  className?: string
}

const ALLOWED_EXT = ['.md', '.txt', '.json', '.cpp', '.c', '.h', '.hpp', '.py', '.js', '.ts', '.jsx', '.tsx', '.html', '.css', '.java', '.rs', '.go', '.sh', '.bat', '.xml', '.yaml', '.yml', '.sql', '.pdf']

function extToFileType(ext: string): string {
  return ext.replace('.', '').toLowerCase()
}

function fileNameTitle(name: string): string {
  for (const ext of ALLOWED_EXT) {
    if (name.toLowerCase().endsWith(ext)) {
      return name.slice(0, -ext.length)
    }
  }
  return name
}

function extractTitle(fileName: string, _content: string): string {
  const base = fileNameTitle(fileName.replace(/^.*[\\/]/, ''))
  return base || '导入页面'
}

export function ImportZone({ onImport, onImportPdf, children, className }: Props) {
  const [dragging, setDragging] = useState(false)
  const [counter, setCounter] = useState(0)

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setCounter(c => {
      const next = c + 1
      if (next === 1) setDragging(true)
      return next
    })
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setCounter(c => {
      const next = c - 1
      if (next <= 0) setDragging(false)
      return Math.max(0, next)
    })
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragging(false)
    setCounter(0)

    const fileList = e.dataTransfer.files
    if (!fileList || fileList.length === 0) return

    const allFiles = Array.from(fileList)
    const textOnly = allFiles.filter(f => {
      const name = f.name.toLowerCase()
      return !name.endsWith('.pdf') && ALLOWED_EXT.some(ext => name.endsWith(ext))
    })
    const pdfOnly = allFiles.filter(f => f.name.toLowerCase().endsWith('.pdf'))

    if (textOnly.length === 0 && pdfOnly.length === 0) return

    const promises: Promise<void>[] = []

    // Text files: read as text
    if (textOnly.length > 0) {
      const readers = textOnly.map(f => {
        return new Promise<ImportFile>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => {
            const content = reader.result as string
            const dotIdx = f.name.lastIndexOf('.')
            const ext = dotIdx >= 0 ? f.name.slice(dotIdx).toLowerCase() : ''
            resolve({
              title: extractTitle(f.name, content),
              content,
              fileType: extToFileType(ext)
            })
          }
          reader.onerror = () => reject(reader.error)
          reader.readAsText(f)
        })
      })
      promises.push(
        Promise.all(readers).then(files => onImport(files))
      )
    }

    // PDF files: read as base64
    if (pdfOnly.length > 0 && onImportPdf) {
      const pdfReaders = pdfOnly.map(f => {
        return new Promise<ImportPdfFile>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => {
            const bytes = new Uint8Array(reader.result as ArrayBuffer)
            // Convert to base64 in chunks to avoid call stack overflow
            let binary = ''
            for (let i = 0; i < bytes.length; i++) {
              binary += String.fromCharCode(bytes[i])
            }
            const base64 = btoa(binary)
            const dotIdx = f.name.lastIndexOf('.')
            const title = dotIdx >= 0 ? f.name.slice(0, dotIdx) : f.name
            resolve({ title, base64, fileName: f.name })
          }
          reader.onerror = () => reject(reader.error)
          reader.readAsArrayBuffer(f)
        })
      })
      promises.push(
        Promise.all(pdfReaders).then(files => onImportPdf(files))
      )
    }

    Promise.all(promises).catch(console.error)
  }, [onImport, onImportPdf])

  return (
    <div
      className={`relative ${className || ''}`}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {children}

      {/* 拖拽遮罩 */}
      {dragging && (
        <div className="absolute inset-0 z-40 bg-[#007acc20] border-2 border-dashed border-[var(--accent)] rounded flex items-center justify-center pointer-events-none">
          <div className="flex flex-col items-center gap-2 text-[var(--accent)]">
            <FileText size={48} strokeWidth={1.5} />
            <span className="text-[15px] font-medium">释放文件以导入</span>
            <span className="text-[12px] opacity-70">支持 .md .cpp .py .html .pdf 等文件</span>
          </div>
        </div>
      )}
    </div>
  )
}
