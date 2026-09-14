'use client'

import { useState, useTransition, useEffect } from 'react'
import { Task, Project, UrgencyCurve, EnergyLevel, computeUrgency } from '@/types'
import { updateTask } from '@/app/actions/tasks'
import { useTimer } from '@/contexts/TimerContext'

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

interface Props {
  task: Task & { project: Project }
  projects: Project[]
  onClose: () => void
}

export default function TaskDetail({ task, projects, onClose }: Props) {
  const timer = useTimer()
  const isTimingThis = timer.phase !== 'idle' && timer.task?.id === task.id

  const [title, setTitle]         = useState(task.title)
  const [description, setDesc]    = useState(task.description ?? '')
  const [priority, setPriority]   = useState(task.priority)
  const [energy, setEnergy]       = useState<EnergyLevel>(task.energy_required)
  const [curve, setCurve]         = useState<UrgencyCurve>(task.urgency_curve)
  const [estimate, setEstimate]   = useState(String(task.estimated_minutes ?? ''))
  const [dueDate, setDueDate]     = useState(task.due_date ? task.due_date.slice(0, 10) : '')
  const [saved, setSaved]         = useState(false)
  const [isPending, startTransition] = useTransition()

  // Live urgency preview — recomputes as user changes fields
  const liveUrgency = computeUrgency({
    priority,
    urgency_curve: curve,
    due_date:      dueDate ? new Date(dueDate).toISOString() : null,
    created_at:    task.created_at,
  })

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
            style={{ background: task.project.color + '18', color: task.project.color }}
          >
            {task.project.name}
          </span>
          <div className="flex items-center gap-2">
            {saved && <span className="text-xs text-teal-500 font-medium">Saved ✓</span>}
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
              className="w-full text-sm text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>

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

          {/* Time estimate + due date */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wide">Estimate (min)</label>
              <input
                type="number"
                min={1}
                value={estimate}
                onChange={e => setEstimate(e.target.value)}
                onBlur={onBlurEstimate}
                placeholder="e.g. 45"
                className="w-full border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-500 font-mono"
              />
              {task.adjusted_minutes && task.adjusted_minutes !== task.estimated_minutes && (
                <p className="text-xs text-violet-500 mt-1">Adjusted: {task.adjusted_minutes}m</p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wide">Due date</label>
              <input
                type="date"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
                onBlur={onBlurDue}
                className="w-full border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
          </div>

          {/* Urgency curve */}
          <div>
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

          {/* Focus timer */}
          {timer.phase === 'idle' ? (
            <button
              onClick={() => timer.start({ ...task, project: task.project })}
              className="w-full py-2.5 rounded-xl border-2 border-teal-500 text-teal-600 dark:text-teal-400 text-sm font-semibold hover:bg-teal-50 dark:hover:bg-teal-900/20 transition-colors flex items-center justify-center gap-2"
            >
              ▶ Start Focus
            </button>
          ) : isTimingThis ? (
            <div className="w-full py-2.5 rounded-xl bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800 text-teal-600 dark:text-teal-400 text-sm font-semibold text-center">
              ⏱ Timer running — see bottom-right
            </div>
          ) : (
            <div className="w-full py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-400 text-sm text-center">
              Timer busy with another task
            </div>
          )}

          {/* Urgency score readout — live preview from local state */}
          <div className="bg-slate-50 dark:bg-slate-800 rounded-xl px-4 py-3 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Urgency score</p>
              <p className="text-xs text-slate-400 mt-0.5">Updates live as you change priority or deadline</p>
            </div>
            <span className={`text-2xl font-semibold font-mono ${
              liveUrgency >= 70 ? 'text-red-500' :
              liveUrgency >= 40 ? 'text-amber-500' : 'text-slate-400'
            }`}>
              {Math.round(liveUrgency)}
            </span>
          </div>

        </div>
      </div>
    </div>
  )
}
