import { useLayoutEffect, useRef, useState } from 'react'

const EDGE_MARGIN = 8

interface MenuPosition {
  left: number
  top: number
}

/**
 * Keep a fixed-position context menu fully inside the window.
 *
 * The menu's real size is measured after render, then the click coordinates are
 * clamped against the viewport with a small edge margin. This replaces hard-coded
 * size estimates, which cut the menu off when it is opened near a window edge.
 */
export function useContextMenuPosition(menu: { x: number; y: number } | null) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<MenuPosition | null>(null)

  useLayoutEffect(() => {
    if (!menu || !menuRef.current) return
    const rect = menuRef.current.getBoundingClientRect()
    const left = Math.max(EDGE_MARGIN, Math.min(menu.x, window.innerWidth - rect.width - EDGE_MARGIN))
    const top = Math.max(EDGE_MARGIN, Math.min(menu.y, window.innerHeight - rect.height - EDGE_MARGIN))
    setPosition({ left, top })
  }, [menu])

  return {
    menuRef,
    style: position ?? { left: menu?.x ?? 0, top: menu?.y ?? 0 },
  }
}
