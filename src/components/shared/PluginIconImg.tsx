import { useState, useEffect } from 'react'
import { Puzzle } from 'lucide-react'

interface Props {
  src?: string          // 插件图标 URL(plugin:// 或 registry iconUrl);空/加载失败回退拼图占位
  size?: number
  className?: string
  rounded?: boolean
}

/** 插件图标:优先展示插件自带图标,加载失败回退为拼图占位符 */
export function PluginIconImg({ src, size = 26, className, rounded = true }: Props) {
  const [failed, setFailed] = useState(false)
  useEffect(() => { setFailed(false) }, [src])

  if (!src || failed) {
    return <Puzzle size={size} strokeWidth={1.5} className={className} />
  }
  return (
    <img
      src={src}
      onError={() => setFailed(true)}
      className={`object-contain shrink-0 ${className || ''}`}
      style={{ width: size, height: size, borderRadius: rounded ? size * 0.22 : 0 }}
      alt=""
      draggable={false}
    />
  )
}
