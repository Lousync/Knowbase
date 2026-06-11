import { X } from 'lucide-react'
import type { ScheduleTodo, ScheduleTag } from '../../../types'

interface Props {
  open: boolean
  todos: ScheduleTodo[]
  tags: ScheduleTag[]
  onClose: () => void
}

// Quadrant layout in Cartesian coordinates:
//         ▲ 重要
//         │
//   Q1    │    Q0
// 重要不紧急│  紧急重要
//         │
// ────────┼────────▶ 紧急
//         │
//   Q3    │    Q2
// 不重要  │  紧急不重要
// 不紧急  │
//

// quadrant values: 0=紧急重要(TL→TR), 1=重要不紧急(TL),
// but for display we need quadrant ID to grid position:
// grid: row0 col0 = TL = Q1 (重要不紧急), row0 col1 = TR = Q0 (紧急重要)
//       row1 col0 = BL = Q3 (不重要不紧急), row1 col1 = BR = Q2 (紧急不重要)

const QUADRANT_CONFIG: Record<number, { label: string; emoji: string; bg: string; border: string; row: number; col: number }> = {
  0: { label: '紧急重要', emoji: '🔥', bg: 'bg-red-500/10', border: 'border-red-500/30', row: 0, col: 1 },
  1: { label: '重要不紧急', emoji: '📌', bg: 'bg-blue-500/10', border: 'border-blue-500/30', row: 0, col: 0 },
  2: { label: '紧急不重要', emoji: '⚡', bg: 'bg-yellow-500/10', border: 'border-yellow-500/30', row: 1, col: 1 },
  3: { label: '不重要不紧急', emoji: '💤', bg: 'bg-gray-500/10', border: 'border-gray-500/30', row: 1, col: 0 },
}

export function QuadrantChart({ open, todos, tags, onClose }: Props) {
  if (!open) return null

  const grouped = new Map<number, ScheduleTodo[]>()
  for (const q of [0, 1, 2, 3]) grouped.set(q, [])
  for (const t of todos) {
    const list = grouped.get(t.quadrant) ?? []
    list.push(t)
    grouped.set(t.quadrant, list)
  }

  function tagOf(todo: ScheduleTodo) {
    if (!todo.tagId) return null
    return tags.find(tg => tg.id === todo.tagId) ?? null
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-[#1e1e1e] border border-[#3c3c3c] rounded-lg w-[720px] max-h-[85vh] shadow-2xl flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#3c3c3c] shrink-0">
          <h3 className="text-[14px] font-medium text-[#cccccc]">四象限视图</h3>
          <button onClick={onClose} className="p-1 text-[#6a6a6a] hover:text-[#cccccc]"><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {/* Coordinate system container */}
          <div className="relative w-full" style={{ paddingTop: '100%' }}>
            {/* Y-axis arrow: 重要 ▲  */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 flex flex-col items-center z-10">
              <span className="text-[12px] font-medium text-[#569cd6]">▲ 重要</span>
            </div>

            {/* X-axis arrow: 紧急 ▶ */}
            <div className="absolute bottom-0 right-2 flex items-center z-10">
              <span className="text-[12px] font-medium text-[#d16969]">紧急 ▶</span>
            </div>

            {/* X-axis opposite: ◀ 不紧急 */}
            <div className="absolute bottom-0 left-2 flex items-center z-10">
              <span className="text-[12px] text-[#555]">◀ 不紧急</span>
            </div>

            {/* Y-axis opposite: 不重要 ▼ */}
            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 flex flex-col items-center z-10">
              <span className="text-[12px] text-[#555]">不重要 ▼</span>
            </div>

            {/* Axes: vertical line (Y) + horizontal line (X) */}
            <div
              className="absolute top-6 bottom-6 left-1/2 border-l border-[#4a4a4a] z-0"
              style={{ width: 0 }}
            />
            <div
              className="absolute left-10 right-10 top-1/2 border-t border-[#4a4a4a] z-0"
              style={{ height: 0 }}
            />

            {/* Origin dot */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-[#6a6a6a] z-10" />

            {/* Four quadrant boxes positioned in the 2x2 grid */}
            {([0, 1, 2, 3] as const).map(q => {
              const cfg = QUADRANT_CONFIG[q]
              const items = grouped.get(q) ?? []
              const top = cfg.row === 0 ? '1.5rem' : 'calc(50% + 0.75rem)'
              const left = cfg.col === 0 ? '1rem' : 'calc(50% + 0.75rem)'
              const width = 'calc(50% - 2.25rem)'
              const height = 'calc(50% - 2.25rem)'

              return (
                <div
                  key={q}
                  className={`absolute ${cfg.bg} ${cfg.border} border rounded-lg p-3 flex flex-col overflow-hidden`}
                  style={{ top, left, width, height }}
                >
                  <h4 className="text-[12px] font-medium text-[#cccccc] mb-2 flex items-center gap-1 shrink-0">
                    <span>{cfg.emoji}</span> {cfg.label}
                    <span className="text-[10px] text-[#6a6a6a] ml-1">({items.length})</span>
                  </h4>
                  <div className="space-y-1 overflow-y-auto flex-1">
                    {items.length === 0 ? (
                      <p className="text-[11px] text-[#555] italic">暂无任务</p>
                    ) : (
                      items.map(t => {
                        const tg = tagOf(t)
                        return (
                          <div key={t.id} className="flex items-center gap-1.5 px-2 py-0.5 bg-[#2d2d2d] rounded text-[11px]">
                            {tg && <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: tg.color }} />}
                            <span className="text-[#cccccc] truncate">{t.title}</span>
                            {t.taskType === 'deadline' && t.time && (
                              <span className="text-[9px] text-[#569cd6] shrink-0 ml-auto">⏰{t.time.slice(0, 10)}</span>
                            )}
                          </div>
                        )
                      })
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
