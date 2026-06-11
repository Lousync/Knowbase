interface TagBadgeProps {
  name?: string
  color: string
  size?: 'sm' | 'md'
}

export function TagBadge({ color, size = 'md' }: TagBadgeProps) {
  const sizeClass = size === 'sm' ? 'w-2.5 h-2.5' : 'w-3 h-3'
  return <span className={`${sizeClass} rounded-full shrink-0`} style={{ backgroundColor: color }} />
}
