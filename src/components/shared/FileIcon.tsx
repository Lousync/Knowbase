import { getFileIcon } from '../../lib/fileIcons'

interface Props {
  ext: string
  size?: number
}

/**
 * vscode-icons file type icon.
 * Renders inline SVG at the given size. Falls back to default file icon.
 */
export function FileIcon({ ext, size = 14 }: Props) {
  const svg = getFileIcon(ext)
  return (
    <span
      className="shrink-0 inline-flex items-center justify-center"
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
