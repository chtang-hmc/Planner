'use client'

import { useState, useTransition, useEffect, useRef } from 'react'
import { Task, Project, UrgencyCurve, EnergyLevel, HabitStreak, INBOX_PROJECT, computeUrgency, computeUrgencyBreakdown } from '@/types'
import { updateTask, getSubtasks, createSubtask, toggleSubtask, deleteSubtask, updateSubtaskFields, deleteHabit, setHabitExclusiveLink, setHabitAvoidAfterBreaks, setTaskPlacement, listHabitExclusivity, type HabitExclusivity, type SubtaskRow } from '@/app/actions/tasks'
import { scheduleTask, unscheduleTask } from '@/app/actions/calendar'
import { useTimer } from '@/contexts/TimerContext'
import RecurrencePicker from '@/components/RecurrencePicker'
import { rruleToLabel } from '@/lib/rrule-utils'

// ── Subtask list ──────────────────────────────────────────────────────────────

const SUBTASK_ENERGY_OPTS = [
  { val: 'low',    icon: '🌿' },
  { val: 'medium', icon: '⚡' },
  { val: 'high',   icon: '🔥' },
] as const

function SubtaskSection({ taskId }: { taskId: string }) {
  const [items,    setItems]    = useState<SubtaskRow[]>([])
  const [newTitle, setNewTitle] = useState('')
  const [newMins,  setNewMins]  = useState('')
  const [loading,  setLoading]  = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [, startTransition]     = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    getSubtasks(taskId).then(rows => { setItems(rows); setLoading(false) })
  }, [taskId])

  function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const t = newTitle.trim()
    if (!t) return
    const mins = newMins ? parseInt(newMins) : null
    const optimistic: SubtaskRow = {
      id: crypto.randomUUID(), title: t, status: 'active',
      estimated_minutes: mins, energy_required: 'low',
      gcal_event_id: null, scheduled_start: null, scheduled_end: null,
      created_at: new Date().toISOString(),
    }
    setItems(prev => [...prev, optimistic])
    setNewTitle('')
    setNewMins('')
    startTransition(async () => {
      await createSubtask(taskId, t, mins)
      const fresh = await getSubtasks(taskId)
      setItems(fresh)
    })
  }

  function handleToggle(sub: SubtaskRow) {
    const done = sub.status !== 'done'
    setItems(prev => prev.map(s => s.id === sub.id ? { ...s, status: done ? 'done' : 'active' } : s))
    startTransition(() => toggleSubtask(sub.id, done))
  }

  function handleDelete(sub: SubtaskRow) {
    setItems(prev => prev.filter(s => s.id !== sub.id))
    startTransition(() => deleteSubtask(sub.id))
  }

  function handleUpdateField(sub: SubtaskRow, patch: { estimated_minutes?: number | null; energy_required?: string }) {
    setItems(prev => prev.map(s => s.id === sub.id ? { ...s, ...patch } : s))
    startTransition(async () => { await updateSubtaskFields(sub.id, taskId, patch) })
  }

  const done  = items.filter(s => s.status === 'done').length
  const total = items.length
  const totalMins = items.filter(s => s.status !== 'done').reduce((acc, s) => acc + (s.estimated_minutes ?? 0), 0)

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">
          Subtasks
        </label>
        <div className="flex items-center gap-2">
          {totalMins > 0 && (
            <span className="text-xs text-slate-400 font-mono">
              {totalMins < 60 ? `${totalMins}m` : `${Math.floor(totalMins/60)}h${totalMins%60 ? ` ${totalMins%60}m` : ''}`}
            </span>
          )}
          {total > 0 && (
            <span className="text-xs text-slate-400 tabular-nums">{done}/{total}</span>
          )}
        </div>
      </div>

      {/* Progress bar */}
      {total > 0 && (
        <div className="h-1 bg-slate-100 dark:bg-slate-800 rounded-full mb-3 overflow-hidden">
          <div
            className="h-full bg-accent-500 rounded-full transition-all duration-300"
            style={{ width: `${(done / total) * 100}%` }}
          />
        </div>
      )}

      {/* Items */}
      {loading ? (
        <p className="text-xs text-slate-400 py-2">Loading…</p>
      ) : (
        <div className="flex flex-col gap-1 mb-2">
          {items.map(sub => (
            <div key={sub.id} className="group">
              {/* Main row */}
              <div className="flex items-start gap-2 py-1">
                <button
                  onClick={() => handleToggle(sub)}
                  className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                    sub.status === 'done'
                      ? 'bg-accent-500 border-accent-500 text-white'
                      : 'border-slate-300 dark:border-slate-600 hover:border-accent-400'
                  }`}
                >
                  {sub.status === 'done' && <span className="text-[10px] leading-none">✓</span>}
                </button>
                <div className="flex-1 min-w-0">
                  <span className={`text-sm leading-snug ${
                    sub.status === 'done'
                      ? 'line-through text-slate-400 dark:text-slate-600'
                      : 'text-slate-700 dark:text-slate-300'
                  }`}>
                    {sub.title}
                  </span>
                  {/* Inline meta */}
                  <div className="flex items-center gap-2 mt-0.5">
                    {sub.estimated_minutes && (
                      <span className="text-[10px] text-slate-400 font-mono">
                        {sub.estimated_minutes}m
                      </span>
                    )}
                    {sub.scheduled_start && (
                      <span className="text-[10px] text-sky-500">
                        📅 {new Date(sub.scheduled_start).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                      </span>
                    )}
                    <button
                      onClick={() => setExpanded(v => v === sub.id ? null : sub.id)}
                      className="text-[10px] text-slate-300 dark:text-slate-700 hover:text-slate-500 dark:hover:text-slate-400 transition-colors"
                    >
                      {expanded === sub.id ? '▲' : '▼'}
                    </button>
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(sub)}
                  className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-400 dark:text-slate-700 dark:hover:text-red-400 transition-all text-xs shrink-0 mt-0.5"
                >
                  ✕
                </button>
              </div>

              {/* Expanded: duration + energy editors */}
              {expanded === sub.id && sub.status !== 'done' && (
                <div className="ml-6 mb-1 flex items-center gap-2 flex-wrap">
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-slate-400">⏱</span>
                    <input
                      type="number"
                      min={1}
                      value={sub.estimated_minutes ?? ''}
                      onChange={e => {
                        const v = e.target.value ? parseInt(e.target.value) : null
                        handleUpdateField(sub, { estimated_minutes: v })
                      }}
                      placeholder="min"
                      className="w-16 border border-slate-200 dark:border-slate-700 rounded px-1.5 py-0.5 text-xs bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-accent-500 font-mono"
                    />
                  </div>
                  <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                    {SUBTASK_ENERGY_OPTS.map(o => (
                      <button
                        key={o.val}
                        onClick={() => handleUpdateField(sub, { energy_required: o.val })}
                        className={`px-2 py-0.5 text-xs transition-colors ${
                          sub.energy_required === o.val
                            ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900'
                            : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                        }`}
                      >
                        {o.icon}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add new */}
      <form onSubmit={handleAdd} className="flex gap-2">
        <input
          ref={inputRef}
          type="text"
          value={newTitle}
          onChange={e => setNewTitle(e.target.value)}
          placeholder="Add a subtask…"
          className="flex-1 text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-accent-500 placeholder:text-slate-300 dark:placeholder:text-slate-600"
        />
        <input
          type="number"
          min={1}
          value={newMins}
          onChange={e => setNewMins(e.target.value)}
          placeholder="min"
          className="w-16 text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-accent-500 font-mono"
        />
        <button
          type="submit"
          disabled={!newTitle.trim()}
          className="px-2.5 py-1.5 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-medium disabled:opacity-30 hover:opacity-80 transition-opacity shrink-0"
        >
          Add
        </button>
      </form>
    </div>
  )
}

const PRIORITY_OPTS = [
  { val: 1, label: 'Low',      color: 'text-slate-400' },
  { val: 2, label: 'Medium',   color: 'text-sky-500' },
  { val: 3, label: 'High',     color: 'text-amber-500' },
  { val: 4, label: 'Critical', color: 'text-red-500' },
]

const ENERGY_OPTS: { val: EnergyLevel; label: string; icon: string }[] = [
  { val: 'low',    label: 'Low',    icon: '🌿' },
  { val: 'medium', label: 'Medium', icon: '⚡' },
  { val: 'high',   label: 'High',   icon: '🔥' },
]

const CURVE_OPTS: { val: UrgencyCurve; label: string; desc: string }[] = [
  { val: 'linear',      label: 'Linear',      desc: 'Steady climb to deadline' },
  { val: 'exponential', label: 'Exponential', desc: 'Calm until final stretch, then spikes' },
  { val: 'step',        label: 'Step',        desc: 'Quiet → moderate → urgent at thresholds' },
]

// ── Schedule section ──────────────────────────────────────────────────────────

function toDatetimeLocal(iso: string): string {
  // Convert ISO timestamp → 'YYYY-MM-DDTHH:MM' for datetime-local input
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function defaultScheduleWindow(task: Task): { start: string; end: string } {
  // Pre-fill with due_date (at 9am) or today at next whole hour
  let startMs: number
  if (task.due_date) {
    const d = new Date(task.due_date.slice(0, 10) + 'T09:00:00')
    startMs = d.getTime()
  } else {
    const now = new Date()
    now.setMinutes(0, 0, 0)
    now.setHours(now.getHours() + 1)
    startMs = now.getTime()
  }
  const durationMs = (task.estimated_minutes ?? 60) * 60_000
  const endMs = startMs + durationMs
  return {
    start: toDatetimeLocal(new Date(startMs).toISOString()),
    end:   toDatetimeLocal(new Date(endMs).toISOString()),
  }
}

function ScheduleSection({
  task,
  gcalWriteEnabled,
}: {
  task: Task & { project: Project }
  gcalWriteEnabled: boolean
}) {
  const defaults = defaultScheduleWindow(task)
  const [startVal, setStartVal] = useState(
    task.scheduled_start ? toDatetimeLocal(task.scheduled_start) : defaults.start
  )
  const [endVal, setEndVal] = useState(
    task.scheduled_end ? toDatetimeLocal(task.scheduled_end) : defaults.end
  )
  const [isScheduled, setIsScheduled] = useState(!!task.gcal_event_id)
  const [schedErr, setSchedErr]       = useState<string | null>(null)
  const [, startTransition]           = useTransition()

  function handleSchedule() {
    setSchedErr(null)
    const startISO = new Date(startVal).toISOString()
    const endISO   = new Date(endVal).toISOString()
    if (endISO <= startISO) { setSchedErr('End must be after start'); return }
    startTransition(async () => {
      const result = await scheduleTask(task.id, startISO, endISO)
      if (result.error) { setSchedErr(result.error); return }
      setIsScheduled(true)
    })
  }

  function handleUnschedule() {
    startTransition(async () => {
      await unscheduleTask(task.id)
      setIsScheduled(false)
      // Reset pickers to suggested defaults
      const d = defaultScheduleWindow(task)
      setStartVal(d.start)
      setEndVal(d.end)
    })
  }

  if (!gcalWriteEnabled) {
    return (
      <div>
        <label className="block text-xs font-medium text-slate-400 mb-2 uppercase tracking-wide">Schedule</label>
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
          <span className="text-base">📅</span>
          <p className="text-xs text-slate-400 flex-1">
            Connect Google Calendar in{' '}
            <a href="/settings" className="text-accent-500 hover:underline">Settings</a>
            {' '}to block focus time.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div>
      <label className="block text-xs font-medium text-slate-400 mb-2 uppercase tracking-wide">
        Schedule
        {isScheduled && <span className="ml-2 normal-case text-sky-500 font-normal">📅 Blocked on calendar</span>}
      </label>

      {isScheduled ? (
        /* Already scheduled — show the block + remove option */
        <div className="flex flex-col gap-2">
          <div className="px-3 py-2.5 rounded-lg bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800">
            <p className="text-xs font-medium text-sky-700 dark:text-sky-300">
              {new Date(startVal).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
              {' · '}
              {new Date(startVal).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
              {' – '}
              {new Date(endVal).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setIsScheduled(false)}
              className="flex-1 py-1.5 text-xs border border-slate-200 dark:border-slate-700 rounded-lg text-slate-500 hover:border-slate-300 transition-colors"
            >
              Edit time
            </button>
            <button
              onClick={handleUnschedule}
              className="flex-1 py-1.5 text-xs border border-red-200 dark:border-red-900 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
            >
              Remove block
            </button>
          </div>
        </div>
      ) : (
        /* Picker */
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] text-slate-400 mb-1">Start</label>
              <input
                type="datetime-local"
                value={startVal}
                onChange={e => {
                  setStartVal(e.target.value)
                  // Auto-advance end by the same duration
                  if (e.target.value) {
                    const newStart = new Date(e.target.value).getTime()
                    const dur = (task.estimated_minutes ?? 60) * 60_000
                    setEndVal(toDatetimeLocal(new Date(newStart + dur).toISOString()))
                  }
                }}
                className="w-full border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 text-xs bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-accent-500"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-400 mb-1">End</label>
              <input
                type="datetime-local"
                value={endVal}
                onChange={e => setEndVal(e.target.value)}
                className="w-full border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 text-xs bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-accent-500"
              />
            </div>
          </div>
          {schedErr && <p className="text-xs text-red-500">{schedErr}</p>}
          <button
            onClick={handleSchedule}
            disabled={!startVal || !endVal}
            className="w-full py-2 rounded-lg bg-sky-500 hover:bg-sky-600 text-white text-xs font-semibold disabled:opacity-40 transition-colors flex items-center justify-center gap-1.5"
          >
            📅 Block time on calendar
          </button>
        </div>
      )}
    </div>
  )
}

interface Props {
  /** `project` is null for tasks with no project_id — the join returns null. */
  task: Task & { project: Project | null }
  projects: Project[]
  streak: HabitStreak | null
  gcalWriteEnabled: boolean
  onClose: () => void
}

export default function TaskDetail({ task, projects, streak, gcalWriteEnabled, onClose }: Props) {
  const timer = useTimer()
  const isTimingThis = timer.phase !== 'idle' && timer.task?.id === task.id

  const [title, setTitle]         = useState(task.title)
  const [description, setDesc]    = useState(task.description ?? '')
  const [priority, setPriority]   = useState(task.priority)
  const [energy, setEnergy]       = useState<EnergyLevel>(task.energy_required)
  const [curve, setCurve]         = useState<UrgencyCurve>(task.urgency_curve)
  const [estimate, setEstimate]   = useState(String(task.estimated_minutes ?? ''))
  const [dueDate, setDueDate]     = useState(task.due_date ? task.due_date.slice(0, 10) : '')
  const [rrule, setRrule]         = useState<string | null>(task.rrule ?? null)
  const [weeklyTarget, setWeeklyTarget] = useState<string>(String(task.weekly_target ?? ''))
  const [saved, setSaved]         = useState(false)
  const [isPending, startTransition] = useTransition()

  // Tasks with no project_id come back from the join as project: null despite
  // the Props type. Resolved here rather than at each call site so any caller
  // can pass a raw row — habits in particular are always project-less.
  const project = task.project ?? INBOX_PROJECT
  const isHabit = task.type === 'habit'

  // Exclusivity — habits linked here are never scheduled on the same day
  const [habitList,  setHabitList]  = useState<HabitExclusivity[]>([])
  const [groupError, setGroupError] = useState<string | null>(null)

  const refreshHabits = () => listHabitExclusivity().then(setHabitList).catch(() => {})
  useEffect(() => { if (isHabit) refreshHabits() }, [isHabit])

  const myGroup = habitList.find(h => h.title === task.title)?.group ?? null
  const others  = habitList.filter(h => h.title !== task.title)

  const avoidAfterBreaks = habitList.find(h => h.title === task.title)?.avoidAfterBreaks ?? false

  function toggleAvoidAfterBreaks(next: boolean) {
    setHabitList(prev => prev.map(h =>
      h.title === task.title ? { ...h, avoidAfterBreaks: next } : h))
    setGroupError(null)
    startTransition(async () => {
      const res = await setHabitAvoidAfterBreaks(task.title, next)
      if (res.error) setGroupError(res.error)
      refreshHabits()
    })
  }

  function toggleLink(otherTitle: string, linked: boolean) {
    // Optimistic: mirror what the action will do so the checkbox responds now
    const group = linked
      ? (others.find(h => h.title === otherTitle)?.group ?? myGroup ?? [task.title, otherTitle].sort().join(' + '))
      : null
    const members = myGroup ? habitList.filter(h => h.group === myGroup).length : 0
    setHabitList(prev => prev.map(h => {
      if (linked) return (h.title === task.title || h.title === otherTitle) ? { ...h, group } : h
      if (h.title === otherTitle) return { ...h, group: null }
      if (h.title === task.title && members <= 2) return { ...h, group: null }
      return h
    }))
    setGroupError(null)

    startTransition(async () => {
      const res = await setHabitExclusiveLink(task.title, otherTitle, linked)
      if (res.error) setGroupError(res.error)
      refreshHabits()          // reconcile with the server either way
    })
  }

  // Where it happens + how long it ties you up
  const [location,  setLocation]  = useState<string>(task.location ?? 'anywhere')
  const [span,      setSpan]      = useState<string>(String(task.span_minutes ?? ''))
  const [buffer,    setBuffer]    = useState<number | null>(task.buffer_minutes ?? null)
  const [placeErr,  setPlaceErr]  = useState<string | null>(null)

  function savePlacement(patch: { location?: string; span_minutes?: number | null; buffer_minutes?: number | null }) {
    setPlaceErr(null)
    startTransition(async () => {
      const res = await setTaskPlacement(task.id, patch)
      if (res.error) setPlaceErr(res.error)
    })
  }

  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting,      setDeleting]      = useState(false)
  const [deleteError,   setDeleteError]   = useState<string | null>(null)

  function handleDeleteHabit() {
    setDeleting(true)
    setDeleteError(null)
    startTransition(async () => {
      const res = await deleteHabit(task.title)
      if (res.error) {
        setDeleting(false)
        setDeleteError(res.error)
        return
      }
      onClose()
    })
  }

  // Live urgency breakdown — recomputes as user changes fields
  const urgencyInput = {
    priority,
    urgency_curve: curve,
    due_date:      dueDate ? new Date(dueDate).toISOString() : null,
    created_at:    task.created_at,
  }
  const liveUrgency    = computeUrgency(urgencyInput)
  const urgencyBreakdown = computeUrgencyBreakdown(urgencyInput)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  function save(patch: Record<string, unknown>) {
    startTransition(async () => {
      await updateTask(task.id, patch)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    })
  }

  function onBlurTitle()    { if (title !== task.title) save({ title }) }
  function onBlurDesc()     { if (description !== (task.description ?? '')) save({ description: description || null }) }
  function onBlurEstimate() { const v = parseInt(estimate); if (!isNaN(v) && v !== task.estimated_minutes) save({ estimated_minutes: v }) }
  function onBlurDue()      { save({ due_date: dueDate ? new Date(dueDate).toISOString() : null }) }

  return (
    /* Backdrop */
    <div className="fixed inset-0 z-40 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-slate-950/20 dark:bg-slate-950/40" />

      {/* Panel */}
      <div
        className="relative w-full max-w-md h-full bg-white dark:bg-slate-900 shadow-2xl flex flex-col overflow-hidden animate-slide-in"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800 shrink-0">
          <span
            className="text-xs font-medium px-2 py-0.5 rounded"
            style={{ background: project.color + '18', color: project.color }}
          >
            {project.name}
          </span>
          <div className="flex items-center gap-2">
            {saved && <span className="text-xs text-accent-500 font-medium">Saved ✓</span>}
            {isPending && <span className="text-xs text-slate-400">Saving…</span>}
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 text-xl leading-none"
            >
              ×
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 flex flex-col gap-5">

          {/* Title */}
          <div>
            <textarea
              value={title}
              onChange={e => setTitle(e.target.value)}
              onBlur={onBlurTitle}
              rows={2}
              className="w-full text-base font-semibold text-slate-900 dark:text-slate-100 bg-transparent resize-none focus:outline-none leading-snug placeholder:text-slate-300"
              placeholder="Task title"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wide">Notes</label>
            <textarea
              value={description}
              onChange={e => setDesc(e.target.value)}
              onBlur={onBlurDesc}
              rows={3}
              placeholder="Add notes, context, links…"
              className="w-full text-sm text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-accent-500"
            />
          </div>

          {/* Checklist */}
          <SubtaskSection taskId={task.id} />

          {/* Priority */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-2 uppercase tracking-wide">Priority</label>
            <div className="flex gap-1.5">
              {PRIORITY_OPTS.map(o => (
                <button
                  key={o.val}
                  onClick={() => { setPriority(o.val as 1|2|3|4); save({ priority: o.val }) }}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    priority === o.val
                      ? 'bg-slate-900 dark:bg-white border-slate-900 dark:border-white text-white dark:text-slate-900'
                      : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:border-slate-300 dark:hover:border-slate-600'
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          {/* Energy */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-2 uppercase tracking-wide">Energy required</label>
            <div className="flex gap-1.5">
              {ENERGY_OPTS.map(o => (
                <button
                  key={o.val}
                  onClick={() => { setEnergy(o.val); save({ energy_required: o.val }) }}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    energy === o.val
                      ? 'bg-slate-900 dark:bg-white border-slate-900 dark:border-white text-white dark:text-slate-900'
                      : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:border-slate-300'
                  }`}
                >
                  {o.icon} {o.label}
                </button>
              ))}
            </div>
          </div>

          {/* Time estimate + due date. Habits are recurring commitments with no
              deadline — their due_date is an internal next-occurrence marker,
              so no date control is offered. */}
          <div className={isHabit ? '' : 'grid grid-cols-2 gap-3'}>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wide">
                {task.type === 'habit' ? 'Session length (min)' : 'Estimate (min)'}
              </label>
              <input
                type="number"
                min={1}
                value={estimate}
                onChange={e => setEstimate(e.target.value)}
                onBlur={onBlurEstimate}
                placeholder="e.g. 45"
                className="w-full border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-accent-500 font-mono"
              />
              {task.adjusted_minutes && task.adjusted_minutes !== task.estimated_minutes && (
                <p className="text-xs text-violet-500 mt-1">Adjusted: {task.adjusted_minutes}m</p>
              )}
            </div>
            {!isHabit && (
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wide">Due date</label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={e => setDueDate(e.target.value)}
                  onBlur={onBlurDue}
                  className="w-full border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-accent-500"
                />
              </div>
            )}
          </div>

          {/* Where it happens + tie-up window */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wide">
              Where
            </label>
            <div className="flex gap-1.5">
              {[
                { val: 'anywhere', label: 'Anywhere', icon: '◎' },
                { val: 'home',     label: 'Home',     icon: '⌂' },
                { val: 'away',     label: 'Out',      icon: '↗' },
              ].map(o => (
                <button
                  key={o.val}
                  onClick={() => { setLocation(o.val); savePlacement({ location: o.val }) }}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    location === o.val
                      ? 'bg-slate-900 dark:bg-white border-slate-900 dark:border-white text-white dark:text-slate-900'
                      : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:border-slate-300'
                  }`}
                >
                  {o.icon} {o.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 mt-2">
              <span className="text-xs text-slate-400 shrink-0">Ties me up for</span>
              <input
                type="number"
                min={1}
                step={15}
                value={span}
                onChange={e => setSpan(e.target.value)}
                onBlur={() => {
                  const v = span ? parseInt(span) : null
                  if (v !== (task.span_minutes ?? null)) savePlacement({ span_minutes: v })
                }}
                placeholder="—"
                className="w-20 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 text-xs bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-accent-500 font-mono"
              />
              <span className="text-xs text-slate-400">min total</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              For things like laundry: only the estimate is booked, but you stay put
              for the full time and nothing that needs you elsewhere is scheduled into it.
            </p>

            {/* Transition buffer */}
            <div className="flex items-center gap-2 mt-3">
              <span className="text-xs text-slate-400 shrink-0">Buffer</span>
              <div className="flex gap-1">
                {[
                  { val: null, label: 'Default' },
                  { val: 0,    label: 'None' },
                  { val: 5,    label: '5m' },
                  { val: 30,   label: '30m' },
                ].map(o => (
                  <button
                    key={String(o.val)}
                    onClick={() => { setBuffer(o.val); savePlacement({ buffer_minutes: o.val }) }}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                      buffer === o.val
                        ? 'bg-slate-900 dark:bg-white border-slate-900 dark:border-white text-white dark:text-slate-900'
                        : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:border-slate-300'
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              Transition time kept clear around this task. Set None for quick chores —
              otherwise a 5-minute job needs half an hour of free space to fit.
            </p>
            {placeErr && <p className="text-xs text-amber-500 mt-1">{placeErr}</p>}
          </div>

          {/* Urgency curve — deadline pressure, so not shown for habits */}
          <div className={isHabit ? 'hidden' : ''}>
            <label className="block text-xs font-medium text-slate-400 mb-2 uppercase tracking-wide">Urgency curve</label>
            <div className="flex flex-col gap-1.5">
              {CURVE_OPTS.map(o => (
                <button
                  key={o.val}
                  onClick={() => { setCurve(o.val); save({ urgency_curve: o.val }) }}
                  className={`flex items-start gap-2.5 px-3 py-2.5 rounded-lg border text-left transition-colors ${
                    curve === o.val
                      ? 'bg-slate-900 dark:bg-white border-slate-900 dark:border-white text-white dark:text-slate-900'
                      : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-slate-300'
                  }`}
                >
                  <span className="text-xs font-semibold w-20 shrink-0 pt-0.5">{o.label}</span>
                  <span className={`text-xs leading-snug ${curve === o.val ? 'opacity-70' : 'text-slate-400'}`}>{o.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Recurrence */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-2 uppercase tracking-wide">
              Repeat
              {rrule && (
                <span className="ml-2 normal-case text-violet-500 dark:text-violet-400 font-normal">
                  ↻ {rruleToLabel(rrule)}
                </span>
              )}
            </label>
            <RecurrencePicker
              value={rrule}
              onChange={newRrule => {
                setRrule(newRrule)
                // Preserve 'habit' type; only toggle between 'task' and 'recurring'
                const newType = task.type === 'habit'
                  ? 'habit'
                  : newRrule ? 'recurring' : 'task'
                save({ rrule: newRrule || null, type: newType })
              }}
            />
          </div>

          {/* Schedule on Google Calendar */}
          <ScheduleSection task={task} gcalWriteEnabled={gcalWriteEnabled} />

          {/* Habit streak — for habits and recurring tasks */}
          {(task.type === 'habit' || task.type === 'recurring') && (
            <div className="bg-violet-50 dark:bg-violet-950/40 border border-violet-100 dark:border-violet-900 rounded-xl px-4 py-3 flex flex-col gap-3">
              <p className="text-xs font-medium text-violet-500 dark:text-violet-400 uppercase tracking-wide">Habit streak</p>

              {/* Streak stats */}
              {streak ? (
                <div className="flex items-end justify-between">
                  <div>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-3xl font-bold text-violet-700 dark:text-violet-300 font-mono tabular-nums leading-none">
                        {streak.current_streak}
                      </span>
                      <span className="text-sm text-violet-500 dark:text-violet-400">
                        {streak.current_streak === 1 ? 'day' : 'days'}
                        {streak.current_streak >= 7 && ' 🔥'}
                      </span>
                    </div>
                    <p className="text-xs text-violet-400 dark:text-violet-500 mt-1">
                      Last: {new Date(streak.last_completed + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-violet-400 dark:text-violet-500">Best</p>
                    <p className="text-lg font-semibold font-mono tabular-nums text-violet-400 dark:text-violet-500">
                      {streak.longest_streak}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-violet-400 dark:text-violet-500">
                  Complete this task to start your streak.
                </p>
              )}

              {/* Weekly goal */}
              {(() => {
                const target = task.weekly_target
                const done   = streak?.completions_this_week ?? 0
                return (
                  <div className="border-t border-violet-100 dark:border-violet-900 pt-3">
                    <p className="text-xs font-medium text-violet-500 dark:text-violet-400 mb-2">Weekly goal</p>
                    {target ? (
                      <div className="flex items-center gap-3">
                        {/* Progress dots */}
                        <span className="flex gap-1">
                          {Array.from({ length: target }, (_, i) => (
                            <span
                              key={i}
                              className={`w-3 h-3 rounded-full ${
                                i < done
                                  ? done >= target ? 'bg-emerald-500' : 'bg-violet-500'
                                  : 'bg-violet-200 dark:bg-violet-800'
                              }`}
                            />
                          ))}
                        </span>
                        <span className={`text-sm font-semibold tabular-nums ${
                          done >= target ? 'text-emerald-500' : 'text-violet-600 dark:text-violet-400'
                        }`}>
                          {done}/{target}{done >= target ? ' ✓' : ''}
                        </span>
                        <span className="text-xs text-violet-400 dark:text-violet-500">this week</span>
                      </div>
                    ) : (
                      <p className="text-xs text-violet-400 dark:text-violet-500">No weekly goal set.</p>
                    )}
                    {/* Exclusivity — pick habits, not a group name */}
                    {others.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-violet-100 dark:border-violet-900">
                        <p className="text-xs font-medium text-violet-500 dark:text-violet-400 mb-1">
                          Never on the same day as
                        </p>
                        <p className="text-[11px] text-violet-400 dark:text-violet-500 mb-2">
                          The scheduler keeps these on separate days. Ticking one links both sides.
                        </p>
                        <div className="flex flex-col gap-1">
                          {others.map(h => {
                            const linked = !!myGroup && h.group === myGroup
                            return (
                              <label
                                key={h.title}
                                className="flex items-center gap-2 cursor-pointer text-xs text-slate-700 dark:text-slate-300"
                              >
                                <input
                                  type="checkbox"
                                  checked={linked}
                                  onChange={e => toggleLink(h.title, e.target.checked)}
                                  className="w-3.5 h-3.5 rounded border-violet-300 dark:border-violet-700 accent-violet-600"
                                />
                                {h.title}
                              </label>
                            )
                          })}
                        </div>
                        {groupError && <p className="text-xs text-amber-500 mt-1.5">{groupError}</p>}
                      </div>
                    )}

                    {/* Post-meal cooldown */}
                    <div className="mt-3 pt-3 border-t border-violet-100 dark:border-violet-900">
                      <label className="flex items-start gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={avoidAfterBreaks}
                          onChange={e => toggleAvoidAfterBreaks(e.target.checked)}
                          className="mt-0.5 w-3.5 h-3.5 rounded border-violet-300 dark:border-violet-700 accent-violet-600"
                        />
                        <span className="text-xs text-slate-700 dark:text-slate-300">
                          Not right after a meal
                          <span className="block text-[11px] text-violet-400 dark:text-violet-500">
                            Leaves the cooldown after lunch and dinner clear (Settings → Meal breaks).
                          </span>
                        </span>
                      </label>
                    </div>

                    {/* Edit target */}
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-xs text-violet-400 dark:text-violet-500 shrink-0">Target</span>
                      <div className="flex gap-1">
                        {[2, 3, 4, 5, 6, 7].map(n => (
                          <button
                            key={n}
                            onClick={() => {
                              const newTarget = weeklyTarget === String(n) ? '' : String(n)
                              setWeeklyTarget(newTarget)
                              save({ weekly_target: newTarget ? n : null })
                            }}
                            className={`w-7 h-7 rounded-lg text-xs font-semibold border transition-colors ${
                              weeklyTarget === String(n)
                                ? 'bg-violet-600 border-violet-600 text-white'
                                : 'border-violet-200 dark:border-violet-800 text-violet-400 hover:border-violet-400'
                            }`}
                          >
                            {n}
                          </button>
                        ))}
                        {weeklyTarget && (
                          <button
                            onClick={() => { setWeeklyTarget(''); save({ weekly_target: null }) }}
                            className="w-7 h-7 rounded-lg text-xs border border-slate-200 dark:border-slate-700 text-slate-400 hover:text-red-400 hover:border-red-300 transition-colors"
                            title="Remove goal"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })()}
            </div>
          )}

          {/* Focus timer */}
          {timer.phase === 'idle' ? (
            <button
              onClick={() => timer.start({ ...task, project })}
              className="w-full py-2.5 rounded-xl border-2 border-accent-500 text-accent-600 dark:text-accent-400 text-sm font-semibold hover:bg-accent-50 dark:hover:bg-accent-900/20 transition-colors flex items-center justify-center gap-2"
            >
              ▶ Start Focus
            </button>
          ) : isTimingThis ? (
            <div className="w-full py-2.5 rounded-xl bg-accent-50 dark:bg-accent-900/20 border border-accent-200 dark:border-accent-800 text-accent-600 dark:text-accent-400 text-sm font-semibold text-center">
              ⏱ Timer running — see bottom-right
            </div>
          ) : (
            <div className="w-full py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-400 text-sm text-center">
              Timer busy with another task
            </div>
          )}

          {/* Urgency breakdown — live preview. Deadline math, so not for habits. */}
          <div className={`bg-slate-50 dark:bg-slate-800 rounded-xl px-4 py-3 flex-col gap-3 ${isHabit ? 'hidden' : 'flex'}`}>
            {/* Score + label row */}
            <div className="flex items-baseline justify-between">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Urgency score</p>
              <span className={`text-2xl font-semibold font-mono tabular-nums ${
                liveUrgency >= 70 ? 'text-red-500' :
                liveUrgency >= 40 ? 'text-amber-500' : 'text-slate-400'
              }`}>
                {Math.round(liveUrgency)}
                <span className="text-xs font-normal text-slate-400 ml-0.5">/ 100</span>
              </span>
            </div>

            {/* Stacked bar: priority | time pressure */}
            <div className="flex flex-col gap-1">
              <div className="flex h-2 rounded-full overflow-hidden bg-slate-200 dark:bg-slate-700">
                {/* Priority segment */}
                <div
                  className="bg-sky-400 dark:bg-sky-500 transition-all duration-300"
                  style={{ width: `${urgencyBreakdown.priorityPts}%` }}
                />
                {/* Time pressure segment */}
                <div
                  className={`transition-all duration-300 ${
                    urgencyBreakdown.timePressure >= 50 ? 'bg-red-400 dark:bg-red-500' :
                    urgencyBreakdown.timePressure >= 25 ? 'bg-amber-400 dark:bg-amber-500' :
                    'bg-accent-400 dark:bg-accent-500'
                  }`}
                  style={{ width: `${Math.min(urgencyBreakdown.timePressure, 100 - urgencyBreakdown.priorityPts)}%` }}
                />
              </div>
              {/* Legend */}
              <div className="flex justify-between text-xs text-slate-400 tabular-nums">
                <span className="flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-sm bg-sky-400 dark:bg-sky-500" />
                  Priority&nbsp;<span className="font-mono">+{Math.round(urgencyBreakdown.priorityPts)}</span>
                </span>
                <span className="flex items-center gap-1">
                  <span className={`inline-block w-2 h-2 rounded-sm ${
                    urgencyBreakdown.timePressure >= 50 ? 'bg-red-400 dark:bg-red-500' :
                    urgencyBreakdown.timePressure >= 25 ? 'bg-amber-400 dark:bg-amber-500' :
                    'bg-accent-400 dark:bg-accent-500'
                  }`} />
                  Time pressure&nbsp;<span className="font-mono">+{Math.round(urgencyBreakdown.timePressure)}</span>
                </span>
              </div>
            </div>

            {/* Timeline progress (only when due date is set) */}
            {urgencyBreakdown.hasDueDate && (
              <div className="flex flex-col gap-1">
                <div className="flex h-1.5 rounded-full overflow-hidden bg-slate-200 dark:bg-slate-700">
                  <div
                    className="bg-slate-400 dark:bg-slate-500 transition-all duration-300"
                    style={{ width: `${urgencyBreakdown.elapsed * 100}%` }}
                  />
                </div>
                <p className="text-xs text-slate-400">
                  {Math.round(urgencyBreakdown.elapsed * 100)}% through lifespan
                  {urgencyBreakdown.elapsed >= 1 && <span className="text-red-500 ml-1 font-medium">· overdue</span>}
                </p>
              </div>
            )}

            {!urgencyBreakdown.hasDueDate && (
              <p className="text-xs text-slate-400">Set a due date to add time pressure</p>
            )}
          </div>

          {isHabit && (
            <div className="border-t border-slate-100 dark:border-slate-800 pt-4">
              {confirmDelete ? (
                <div className="flex flex-col gap-2">
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Delete <span className="font-medium">{task.title}</span> and its entire
                    history? Every logged completion and its streak are removed. This can't be undone.
                  </p>
                  {deleteError && <p className="text-xs text-red-500">{deleteError}</p>}
                  <div className="flex gap-2">
                    <button
                      onClick={handleDeleteHabit}
                      disabled={deleting}
                      className="px-3 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white text-xs font-semibold disabled:opacity-50 transition-colors"
                    >
                      {deleting ? 'Deleting…' : 'Delete habit'}
                    </button>
                    <button
                      onClick={() => { setConfirmDelete(false); setDeleteError(null) }}
                      disabled={deleting}
                      className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 text-xs font-medium transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="text-xs text-slate-400 hover:text-red-500 transition-colors"
                >
                  Delete habit…
                </button>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
