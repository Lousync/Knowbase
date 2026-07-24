import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { ArrowLeft, Plus, Trash2, X, TrendingDown, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react'
import type { WeightRecord } from '../../../types'
import { getWeightRecords, getWeightSeries, createWeightRecord, updateWeightRecord, deleteWeightRecord } from '../../../lib/ipc'
import { showToast } from '../../../lib/toast'

interface Props { onBack: () => void }

const SERIES_COLORS = ['#007acc', '#e74856', '#16a34a', '#ea580c', '#9333ea', '#0891b2', '#c026d3', '#ca8a04']
const BASE_POINT_SPACING = 50
const PADDING = { left: 52, top: 20, right: 24, bottom: 40 }

export function WeightTracker({ onBack }: Props) {
  const [records, setRecords] = useState<WeightRecord[]>([])
  const [seriesList, setSeriesList] = useState<string[]>([])
  const [selectedSeries, setSelectedSeries] = useState<Set<string>>(new Set(['default']))
  const [unit, setUnit] = useState<'kg' | 'jin'>('kg')
  const [loading, setLoading] = useState(true)
  const [tooltip, setTooltip] = useState<{ x: number; y: number; record: WeightRecord } | null>(null)

  // New/edit form
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [formWeight, setFormWeight] = useState('')
  const [formDate, setFormDate] = useState(new Date().toISOString().slice(0, 10))
  const [formSeries, setFormSeries] = useState('default')
  const [formNewSeries, setFormNewSeries] = useState('')
  const [formNote, setFormNote] = useState('')

  // Delete confirm
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [canvasWidth, setCanvasWidth] = useState(600)
  const canvasHeight = 300

  // Zoom state
  const [xZoom, setXZoom] = useState(1)
  const [yZoom, setYZoom] = useState(1)
  const xZoomRef = useRef(xZoom); useEffect(() => { xZoomRef.current = xZoom }, [xZoom])
  const yZoomRef = useRef(yZoom); useEffect(() => { yZoomRef.current = yZoom }, [yZoom])

  // Load data
  const loadData = useCallback(async () => {
    try {
      const [recs, sers] = await Promise.all([getWeightRecords(), getWeightSeries()])
      setRecords(recs)
      setSeriesList(sers.length > 0 ? sers : ['default'])
      // Auto-select all series so multiple lines show at once
      if (sers.length > 0) setSelectedSeries(new Set(sers))
    } catch (e) { console.error(e) } finally { setLoading(false) }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  // Calculate canvas width based on data
  useEffect(() => {
    const containerWidth = containerRef.current?.clientWidth || 600
    const allDates = [...new Set(records.filter(r => selectedSeries.has(r.series)).map(r => r.date))].sort()
    const spacing = BASE_POINT_SPACING * xZoom
    const neededWidth = Math.max(containerWidth, allDates.length * spacing + PADDING.left + PADDING.right)
    setCanvasWidth(neededWidth)
  }, [records, selectedSeries, xZoom])

  // Draw canvas
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = canvasWidth * dpr
    canvas.height = canvasHeight * dpr
    canvas.style.width = canvasWidth + 'px'
    canvas.style.height = canvasHeight + 'px'
    ctx.scale(dpr, dpr)

    const w = canvasWidth, h = canvasHeight
    ctx.clearRect(0, 0, w, h)

    // Collect all dates across selected series
    const allDates = [...new Set(records.filter(r => selectedSeries.has(r.series)).map(r => r.date))].sort()
    if (allDates.length === 0) return

    // Collect all weights across selected series for Y scale
    const selectedRecords = records.filter(r => selectedSeries.has(r.series))
    if (selectedRecords.length === 0) return

    const rawMin = Math.min(...selectedRecords.map(r => r.weight))
    const rawMax = Math.max(...selectedRecords.map(r => r.weight))
    const rawRange = rawMax - rawMin || 1
    // Decide step size: aim for ~8 grid lines
    const roughStep = rawRange / 8
    const step = roughStep >= 10 ? Math.ceil(roughStep / 5) * 5
               : roughStep >= 5 ? Math.ceil(roughStep)
               : roughStep >= 1 ? Math.ceil(roughStep * 2) / 2
               : Math.ceil(roughStep * 5) / 5
    const margin = step * 0.8
    const yMin = Math.floor((rawMin - margin) / step) * step
    const yMax = Math.ceil((rawMax + margin) / step) * step
    const yRange = yMax - yMin || 1
    const ySteps = Math.round(yRange / step)

    const pointSpacing = BASE_POINT_SPACING * xZoom
    const yMinScaled = yMin - (yMax - yMin) * (yZoom - 1) * 0.3
    const yMaxScaled = yMax + (yMax - yMin) * (yZoom - 1) * 0.3
    const yRangeScaled = yMaxScaled - yMinScaled || 1

    const getX = (date: string) => PADDING.left + allDates.indexOf(date) * pointSpacing
    const getY = (weight: number) => PADDING.top + (1 - (weight - yMinScaled) / yRangeScaled) * (h - PADDING.top - PADDING.bottom)

    const isDark = document.documentElement.className.includes('theme-dark') || !document.documentElement.className.includes('theme-light')
    const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'
    const textColor = isDark ? '#888' : '#999'
    const axisColor = isDark ? '#555' : '#ddd'

    // Grid + Y-axis labels
    ctx.strokeStyle = gridColor; ctx.lineWidth = 1
    ctx.fillStyle = textColor; ctx.font = '10px sans-serif'; ctx.textAlign = 'right'
    for (let i = 0; i <= ySteps; i++) {
      const y = PADDING.top + (i / ySteps) * (h - PADDING.top - PADDING.bottom)
      ctx.beginPath(); ctx.moveTo(PADDING.left, y); ctx.lineTo(w - PADDING.right, y); ctx.stroke()
      const val = yMaxScaled - (i / ySteps) * yRangeScaled
      const display = unit === 'kg' ? val.toFixed(1) : (val * 2).toFixed(1)
      ctx.fillText(display, PADDING.left - 6, y + 3)
    }

    // X-axis line
    ctx.strokeStyle = axisColor; ctx.beginPath()
    ctx.moveTo(PADDING.left, h - PADDING.bottom); ctx.lineTo(w - PADDING.right, h - PADDING.bottom); ctx.stroke()

    // X-axis labels
    ctx.fillStyle = textColor; ctx.textAlign = 'center'
    const labelStep = Math.max(1, Math.floor(allDates.length / 12))
    allDates.forEach((date, i) => {
      if (i % labelStep !== 0 && i !== allDates.length - 1) return
      const x = getX(date)
      ctx.fillText(date.slice(5), x, h - PADDING.bottom + 14)
    })

    // Draw lines per series
    let colorIdx = 0
    for (const series of [...selectedSeries].sort()) {
      const seriesRecords = records.filter(r => r.series === series).sort((a, b) => a.date.localeCompare(b.date))
      if (seriesRecords.length < 1) continue

      const color = SERIES_COLORS[colorIdx % SERIES_COLORS.length]
      colorIdx++

      // Line
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = 'round'
      ctx.beginPath()
      seriesRecords.forEach((r, i) => {
        const x = getX(r.date), y = getY(r.weight)
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
      })
      ctx.stroke()

      // Points
      seriesRecords.forEach(r => {
        const x = getX(r.date), y = getY(r.weight)
        ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill()
        ctx.fillStyle = isDark ? '#1e1e1e' : '#fff'; ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.fill()
      })
    }

    // Mouse handler
    const onMouseMove = (e_: MouseEvent) => {
      const rect = canvas.getBoundingClientRect()
      const mx = e_.clientX - rect.left, my = e_.clientY - rect.top
      let found: WeightRecord | null = null
      let minDist = 20
      for (const r of selectedRecords) {
        const x = getX(r.date), y = getY(r.weight)
        const d = Math.hypot(mx - x, my - y)
        if (d < minDist) { minDist = d; found = r }
      }
      if (found) {
        setTooltip({ x: getX(found.date), y: getY(found.weight), record: found })
      } else {
        setTooltip(null)
      }
    }
    const onMouseLeave = () => setTooltip(null)

    canvas.onmousemove = onMouseMove
    canvas.onmouseleave = onMouseLeave
  }, [records, selectedSeries, unit, canvasWidth, xZoom, yZoom])

  // Wheel zoom handler
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const zoomStep = 0.15
      const clamp = (v: number) => Math.max(0.3, Math.min(4, v))
      if (e.ctrlKey) {
        // Ctrl+wheel → zoom Y axis
        const newY = clamp(yZoomRef.current + (e.deltaY < 0 ? zoomStep : -zoomStep))
        setYZoom(newY)
      } else {
        // Plain wheel → zoom X axis
        const newX = clamp(xZoomRef.current + (e.deltaY < 0 ? zoomStep : -zoomStep))
        setXZoom(newX)
      }
    }
    container.addEventListener('wheel', onWheel, { passive: false })
    return () => container.removeEventListener('wheel', onWheel)
  }, [])

  // Toggle series
  const toggleSeries = (s: string) => {
    setSelectedSeries(prev => {
      const next = new Set(prev)
      if (next.has(s)) { if (next.size > 1) next.delete(s) }
      else next.add(s)
      return next
    })
  }

  // CRUD
  const handleSubmit = async () => {
    const w = parseFloat(formWeight)
    if (isNaN(w) || w <= 0) { showToast({ type: 'error', message: '请输入有效的体重' }); return }
    const series = formNewSeries.trim() || formSeries
    try {
      if (editId) {
        await updateWeightRecord(editId, { weight: w, date: formDate, series, note: formNote })
      } else {
        await createWeightRecord({ weight: w, date: formDate, series, note: formNote })
      }
      setShowForm(false); setEditId(null)
      setFormWeight(''); setFormNewSeries(''); setFormNote('')
      // Auto-add new series to selected
      if (!selectedSeries.has(series)) setSelectedSeries(prev => new Set([...prev, series]))
      loadData()
    } catch (e) { console.error(e); showToast({ type: 'error', message: '保存失败' }) }
  }

  const handleEdit = (r: WeightRecord) => {
    setEditId(r.id); setFormWeight(String(r.weight)); setFormDate(r.date)
    setFormSeries(r.series); setFormNewSeries(''); setFormNote(r.note); setShowForm(true)
  }

  const handleDelete = async (id: string) => {
    setDeleteId(null)
    try { await deleteWeightRecord(id); loadData() } catch (e) { console.error(e) }
  }

  const displayWeight = (kg: number) => unit === 'kg' ? kg.toFixed(1) + ' kg' : (kg * 2).toFixed(1) + ' 斤'

  // Formatted today
  const today = new Date().toISOString().slice(0, 10)

  // All display records for list (across selected series, sorted by date desc)
  const displayRecords = useMemo(() =>
    records.filter(r => selectedSeries.has(r.series)).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
    [records, selectedSeries]
  )

  return (
    <div className="flex flex-col h-full bg-[var(--bg-primary)]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="flex items-center gap-1.5 text-[13px] text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors">
            <ArrowLeft size={15} /> 返回
          </button>
          <div className="w-px h-4 bg-[var(--border-color)]" />
          <TrendingDown size={17} className="text-[var(--accent)]" />
          <h2 className="text-[14px] font-semibold text-[var(--text-primary)]">体重追踪</h2>
        </div>
        <button onClick={() => { setEditId(null); setFormWeight(''); setFormDate(today); setFormSeries(seriesList[0] || 'default'); setFormNewSeries(''); setFormNote(''); setShowForm(true) }}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] bg-[var(--accent)] text-white rounded hover:bg-[var(--accent-hover)] transition-colors">
          <Plus size={14} /> 记录
        </button>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-4 px-4 py-2 border-b border-[var(--border-color)] bg-[var(--bg-primary)] shrink-0">
        <div className="flex items-center gap-1.5 text-[11px]">
          <span className="text-[var(--text-muted)]">系列:</span>
          <div className="flex items-center gap-0.5 flex-wrap">
            {seriesList.map(s => (
              <button key={s} onClick={() => toggleSeries(s)}
                className={`px-1.5 py-0.5 rounded text-[11px] border transition-colors ${
                  selectedSeries.has(s) ? 'text-white border-transparent' : 'text-[var(--text-secondary)] border-[var(--border-color)] hover:border-[var(--text-muted)]'
                }`}
                style={selectedSeries.has(s) ? { backgroundColor: SERIES_COLORS[seriesList.indexOf(s) % SERIES_COLORS.length] } : {}}
              >{s}</button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-0.5 text-[11px] ml-auto">
          <span className="text-[var(--text-muted)]">缩放:</span>
          <button onClick={() => { setXZoom(1); setYZoom(1) }}
            className="px-1 py-0.5 rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
            title="重置缩放">
            <RotateCcw size={12} />
          </button>
          <span className="text-[var(--text-muted)]">X:{xZoom.toFixed(1)}</span>
          <span className="text-[var(--text-muted)]">Y:{yZoom.toFixed(1)}</span>
          <span className="text-[var(--text-muted)] ml-1">| 单位:</span>
          <button onClick={() => setUnit('kg')} className={`px-1.5 py-0.5 rounded ${unit === 'kg' ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>kg</button>
          <button onClick={() => setUnit('jin')} className={`px-1.5 py-0.5 rounded ${unit === 'jin' ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>斤</button>
        </div>
      </div>

      {/* Chart */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div ref={containerRef} className="flex-1 overflow-x-auto overflow-y-hidden relative" style={{ position: 'relative' }}>
          <canvas ref={canvasRef} style={{ minHeight: canvasHeight }} />
          {tooltip && (
            <div className="absolute z-10 pointer-events-none bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded px-2 py-1 shadow-lg text-[11px]"
              style={{ left: tooltip.x + 12, top: tooltip.y - 30 }}>
              <div className="font-medium text-[var(--text-primary)]">{displayWeight(tooltip.record.weight)}</div>
              <div className="text-[var(--text-muted)]">{tooltip.record.date} · {tooltip.record.series}</div>
              {tooltip.record.note && <div className="text-[var(--text-muted)] text-[10px]">{tooltip.record.note}</div>}
            </div>
          )}
        </div>

        {/* Record list */}
        <div className="border-t border-[var(--border-color)] bg-[var(--bg-secondary)] max-h-[180px] overflow-y-auto shrink-0">
          <div className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wide px-4 py-2 border-b border-[var(--border-color)]">记录列表 · {displayRecords.length} 条</div>
          {displayRecords.length === 0 ? (
            <div className="text-[11px] text-[var(--text-disabled)] text-center py-6">暂无记录</div>
          ) : (
            displayRecords.map(r => {
              const colorIdx = seriesList.indexOf(r.series)
              const color = SERIES_COLORS[colorIdx >= 0 ? colorIdx % SERIES_COLORS.length : 0]
              return (
                <div key={r.id} className="flex items-center gap-2 px-4 py-1.5 border-b border-[var(--border-color)] hover:bg-[var(--bg-hover)] text-[12px]">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                  <span className="text-[var(--text-primary)] w-16">{r.date.slice(5)}</span>
                  <span className="text-[var(--text-primary)] font-medium w-20">{displayWeight(r.weight)}</span>
                  <span className="text-[var(--text-muted)] text-[11px] w-16 truncate">{r.series}</span>
                  <span className="text-[var(--text-disabled)] flex-1 truncate text-[10px]">{r.note || '-'}</span>
                  <button onClick={() => handleEdit(r)} className="p-0.5 text-[var(--text-muted)] hover:text-[var(--accent)]">✏️</button>
                  <button onClick={() => setDeleteId(r.id)} className="p-0.5 text-[var(--text-muted)] hover:text-[var(--danger)]">🗑</button>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Form modal */}
      {showForm && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50" onClick={() => setShowForm(false)}>
          <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg shadow-2xl" style={{ width: '380px' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-color)]">
              <span className="text-[13px] font-semibold text-[var(--text-primary)]">{editId ? '编辑记录' : '记录体重'}</span>
              <button onClick={() => setShowForm(false)} className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"><X size={16} /></button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="text-[11px] font-medium text-[var(--text-secondary)] block mb-1">日期</label>
                <input type="date" value={formDate} onChange={e => setFormDate(e.target.value)}
                  className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--border-color)] rounded-md text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]" />
              </div>
              <div>
                <label className="text-[11px] font-medium text-[var(--text-secondary)] block mb-1">体重 (kg)</label>
                <input type="number" step="0.1" value={formWeight} onChange={e => setFormWeight(e.target.value)} placeholder="如 70.5" autoFocus
                  onKeyDown={e => { if (e.key === 'Enter') handleSubmit() }}
                  className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--border-color)] rounded-md text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]" />
              </div>
              <div>
                <label className="text-[11px] font-medium text-[var(--text-secondary)] block mb-1">系列</label>
                <div className="flex gap-2">
                  <select value={formSeries} onChange={e => setFormSeries(e.target.value)}
                    className="flex-1 px-2 py-2 bg-[var(--input-bg)] border border-[var(--border-color)] rounded-md text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]">
                    {seriesList.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <input value={formNewSeries} onChange={e => setFormNewSeries(e.target.value)} placeholder="新系列名"
                    className="w-28 px-2 py-2 bg-[var(--input-bg)] border border-[var(--border-color)] rounded-md text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-disabled)]" />
                </div>
              </div>
              <div>
                <label className="text-[11px] font-medium text-[var(--text-secondary)] block mb-1">备注</label>
                <input value={formNote} onChange={e => setFormNote(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleSubmit() }} placeholder="可选"
                  className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--border-color)] rounded-md text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-disabled)]" />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[var(--border-color)]">
              <button onClick={() => setShowForm(false)} className="px-4 py-1.5 text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded hover:bg-[var(--bg-hover)]">取消</button>
              <button onClick={handleSubmit} disabled={!formWeight} className="px-4 py-1.5 text-[12px] bg-[var(--accent)] text-white rounded hover:bg-[var(--accent-hover)] disabled:opacity-50">保存</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {deleteId && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50" onClick={() => setDeleteId(null)}>
          <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg shadow-2xl p-5" style={{ width: '320px' }} onClick={e => e.stopPropagation()}>
            <p className="text-[13px] text-[var(--text-primary)] mb-1 font-medium">确认删除</p>
            <p className="text-[11px] text-[var(--text-muted)] mb-4">确定要删除此记录吗？</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleteId(null)} className="px-4 py-1.5 text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded hover:bg-[var(--bg-hover)]">取消</button>
              <button onClick={() => handleDelete(deleteId)} className="px-4 py-1.5 text-[12px] bg-[var(--danger)] text-white rounded hover:bg-[#c62828]">删除</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
