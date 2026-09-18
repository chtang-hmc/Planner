'use client'

import { useRef, useState } from 'react'
import { CalendarIcon, FocusIcon } from '@/components/icons'
import type { ExistingItem } from '@/app/actions/scheduling'
import type { PreviewBlock } from '@/components/SchedulePreviewModal'

// ── Layout constants ──────────────────────────────────────────────────────────

const PX_PER_MIN  = 0.9          // 54px per hour
const SNAP_MIN    = 15
const MIN_SPAN_H  = 10           // never show a sliver of a day

const PRIORITY_BG: Record<number, string> = {
  4: 'bg-red-500/15    border-red-400    dark:border-red-500',
  3: 'bg-amber-500/15  border-amber-400  dark:border-amber-500',
  2: 'bg-sky-500/15    border-sky-400    dark:border-sky-500',
  1: 'bg-slate-400/15  border-slate-300  dark:border-slate-600',
}

// ── Time helpers (all local time) ─────────────────────────────────────────────

const dayKey    = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
const minsOfDay = (d: Date) => d.getHours() * 60 + d.getMinutes()

function fmtTime(d: Date) {
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}
function fmtHour(h: number) {
  const ampm = h >= 12 ? 'p' : 'a'
  const hr   = h % 12 === 0 ? 12 : h % 12
  return `${hr}${ampm}`
}

export interface CalendarBlock {
  key:      string
  block:    PreviewBlock
  start:    Date
  end:      Date
  rejected: boolean
}

interface Props {
  proposals: CalendarBlock[]
  existing:  ExistingItem[]
  onToggle:  (key: string) => void
  /** Fired when a block is dragged to a new time. */
  onMove:    (key: string, start: Date, end: Date) => void
}

/**
 * Lay items out in lanes so overlapping blocks sit side by side, the way a
 * calendar does.
 *
 * Width is decided per *cluster* of mutually overlapping items, not per day: a
 * day-wide lane count makes every block on the day narrow just because two of
 * them happen to collide at 1pm.
 */
function assignLanes<T extends { start: Date; end: Date }>(items: T[]) {
  const sorted = [...items].sort((a, b) => a.start.getTime() - b.start.getTime())
  const out: { item: T; lane: number; lanes: number }[] = []

  let cluster: { item: T; lane: number }[] = []
  let laneEnds: number[] = []
  let clusterEnd = -Infinity

  const flush = () => {
    const lanes = Math.max(1, laneEnds.length)
    for (const c of cluster) out.push({ ...c, lanes })
    cluster = []
    laneEnds = []
  }

  for (const item of sorted) {
    // A gap with nothing running closes the cluster and resets the width
    if (item.start.getTime() >= clusterEnd) { flush(); clusterEnd = -Infinity }

    let lane = laneEnds.findIndex(end => end <= item.start.getTime())
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(0) }
    laneEnds[lane] = item.end.getTime()
    clusterEnd = Math.max(clusterEnd, item.end.getTime())
    cluster.push({ item, lane })
  }
  flush()

  return out
}

export default function ScheduleWeekCalendar({ proposals, existing, onToggle, onMove }: Props) {
  const gridRef = useRef<HTMLDivElement>(null)
  const [dragKey, setDragKey] = useState<string | null>(null)
  const grabOffsetMin = useRef(0)

  const existingParsed = existing.map(e => ({
    item: e, start: new Date(e.startISO), end: new Date(e.endISO),
  }))

  // ── Visible range ─────────────────────────────────────────────────────────
  const allTimes = [...proposals, ...existingParsed]
  const days = [...new Set(allTimes.map(x => dayKey(x.start)))].sort()

  let startH = 8, endH = 20
  if (allTimes.length > 0) {
    startH = Math.min(...allTimes.map(x => Math.floor(minsOfDay(x.start) / 60)))
    endH   = Math.max(...allTimes.map(x => Math.ceil(minsOfDay(x.end) / 60)))
    startH = Math.max(0, startH - 1)
    endH   = Math.min(24, endH + 1)
    if (endH - startH < MIN_SPAN_H) endH = Math.min(24, startH + MIN_SPAN_H)
  }
  const rangeStartMin = startH * 60
  const totalMin      = (endH - startH) * 60
  const gridHeight    = totalMin * PX_PER_MIN
  const hours         = Array.from({ length: endH - startH }, (_, i) => startH + i)

  const topFor    = (d: Date) => (minsOfDay(d) - rangeStartMin) * PX_PER_MIN
  const heightFor = (a: Date, b: Date) => Math.max(18, ((b.getTime() - a.getTime()) / 60000) * PX_PER_MIN)

  // ── Dragging ──────────────────────────────────────────────────────────────

  function beginDrag(e: React.PointerEvent, cb: CalendarBlock) {
    e.preventDefault()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    grabOffsetMin.current = (e.clientY - rect.top) / PX_PER_MIN
    setDragKey(cb.key)
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  function onDragMove(e: React.PointerEvent, cb: CalendarBlock) {
    if (dragKey !== cb.key || !gridRef.current) return
    const rect = gridRef.current.getBoundingClientRect()

    // Which day column is the pointer over?
    const colW  = rect.width / days.length
    const colIx = Math.min(days.length - 1, Math.max(0, Math.floor((e.clientX - rect.left) / colW)))
    const [y, m, d] = days[colIx].split('-').map(Number)

    // Y → minutes, snapped, clamped so the block stays inside the visible range
    const rawMin  = (e.clientY - rect.top) / PX_PER_MIN - grabOffsetMin.current + rangeStartMin
    const durMin  = (cb.end.getTime() - cb.start.getTime()) / 60000
    const snapped = Math.round(rawMin / SNAP_MIN) * SNAP_MIN
    const clamped = Math.max(rangeStartMin, Math.min(snapped, rangeStartMin + totalMin - durMin))

    const start = new Date(y, m - 1, d, 0, clamped)
    onMove(cb.key, start, new Date(start.getTime() + durMin * 60000))
  }

  function endDrag() { setDragKey(null) }

  if (days.length === 0) {
    return <p className="text-sm text-slate-400 text-center py-10">Nothing to show for this week.</p>
  }

  return (
    <div className="flex text-xs select-none">
      {/* Hour gutter */}
      <div className="shrink-0 w-10 pt-6">
        {hours.map(h => (
          <div key={h} style={{ height: 60 * PX_PER_MIN }} className="relative">
            <span className="absolute -top-1.5 right-1 text-[10px] text-slate-400 tabular-nums">
              {fmtHour(h)}
            </span>
          </div>
        ))}
      </div>

      <div className="flex-1 min-w-0">
        {/* Day headers */}
        <div className="flex h-6">
          {days.map(dk => {
            const d = new Date(dk + 'T00:00:00')
            const isToday = dk === dayKey(new Date())
            return (
              <div key={dk} className="flex-1 min-w-0 text-center">
                <span className={`text-[10px] font-semibold uppercase tracking-wide ${
                  isToday ? 'text-accent-500' : 'text-slate-400'
                }`}>
                  {d.toLocaleDateString(undefined, { weekday: 'short' })} {d.getDate()}
                </span>
              </div>
            )
          })}
        </div>

        {/* Grid */}
        <div
          ref={gridRef}
          className="relative flex border-t border-slate-200 dark:border-slate-700"
          style={{ height: gridHeight }}
        >
          {/* Hour lines */}
          {hours.map((h, i) => (
            <div
              key={h}
              className="absolute left-0 right-0 border-t border-slate-100 dark:border-slate-800 pointer-events-none"
              style={{ top: i * 60 * PX_PER_MIN }}
            />
          ))}

          {days.map(dk => {
            const dayProposals = proposals.filter(p => dayKey(p.start) === dk)
            const dayExisting  = existingParsed.filter(x => dayKey(x.start) === dk)
            const placed = assignLanes([...dayProposals, ...dayExisting])

            return (
              <div key={dk} className="flex-1 min-w-0 relative border-l border-slate-100 dark:border-slate-800">
                {placed.map(({ item, lane, lanes }) => {
                  const width = `calc(${100 / lanes}% - 3px)`
                  const left  = `calc(${(lane * 100) / lanes}% + 1px)`
                  const style = {
                    top: topFor(item.start),
                    height: heightFor(item.start, item.end),
                    width, left,
                  }

                  if ('item' in item) {
                    const e = item.item
                    return (
                      <div
                        key={`x-${e.id}-${e.startISO}`}
                        style={style}
                        className="absolute rounded-md border border-dashed border-slate-300 dark:border-slate-600 bg-slate-100/60 dark:bg-slate-800/60 px-1.5 py-0.5 overflow-hidden"
                        title={`${e.title} — ${fmtTime(item.start)}`}
                      >
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate leading-tight">
                          {e.kind === 'event' ? <CalendarIcon size={10} className="inline-block mr-1 -mt-px" /> : <FocusIcon size={10} className="inline-block mr-1 -mt-px" />}{e.title}
                        </p>
                        <p className="text-[9px] text-slate-400 truncate">{fmtTime(item.start)}</p>
                      </div>
                    )
                  }

                  const cb = item as CalendarBlock
                  const dragging = dragKey === cb.key
                  return (
                    <div
                      key={cb.key}
                      style={style}
                      onPointerDown={e => beginDrag(e, cb)}
                      onPointerMove={e => onDragMove(e, cb)}
                      onPointerUp={endDrag}
                      onPointerCancel={endDrag}
                      title={`${cb.block.taskTitle} — drag to move`}
                      className={`absolute rounded-md border px-1.5 py-0.5 overflow-hidden cursor-grab active:cursor-grabbing transition-shadow ${
                        PRIORITY_BG[cb.block.taskPriority] ?? PRIORITY_BG[1]
                      } ${dragging ? 'shadow-lg z-20 opacity-90' : 'z-10'} ${
                        cb.rejected ? 'opacity-35 grayscale' : ''
                      }`}
                    >
                      <div className="flex items-start gap-1">
                        <input
                          type="checkbox"
                          checked={!cb.rejected}
                          onChange={() => onToggle(cb.key)}
                          onPointerDown={e => e.stopPropagation()}
                          className="mt-0.5 w-3 h-3 rounded accent-accent-500 shrink-0"
                        />
                        <p className={`text-[10px] font-medium truncate leading-tight ${
                          cb.rejected ? 'line-through text-slate-500' : 'text-slate-800 dark:text-slate-100'
                        }`}>
                          {cb.block.taskTitle}
                        </p>
                      </div>
                      <p className="text-[9px] text-slate-500 dark:text-slate-400 truncate">
                        {fmtTime(cb.start)}
                        {cb.block.totalSegments > 1 && ` · ${cb.block.segmentIndex + 1}/${cb.block.totalSegments}`}
                      </p>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
