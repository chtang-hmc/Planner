'use client'

import { useState, useTransition } from 'react'
import { StatsIcon, OverdueIcon, InboxIcon, CalendarIcon, ArchiveIcon, DoneIcon, CelebrateIcon } from '@/components/icons'
import { Task, Project } from '@/types'
import { ReviewData } from './page'
import { triageTask, saveWeeklyReview } from '@/app/actions/tasks'
import AddTaskModal from '@/components/AddTaskModal'

// ── helpers ──────────────────────────────────────────────────────────────────

function formatMinutes(m: number | null) {
  if (!m) return null
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60), r = m % 60
  return r ? `${h}h ${r}m` : `${h}h`
}

/**
 * Render a due date as the day it was picked.
 *
 * A due date is a calendar day stored at UTC midnight, so handing the whole
 * instant to toLocaleDateString shifts it: 2026-09-16T00:00Z is 5pm on the
 * 15th in California, and a task due tomorrow rendered as today. Formatting
 * the date part in UTC keeps the day that was chosen.
 */
function formatDate(iso: string) {
  return new Date(iso.slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  })
}

/** Today where the user is, as YYYY-MM-DD — the same shape a due date slices to. */
function localToday() {
  const d = new Date()
  return d.getFullYear() + '-'
    + String(d.getMonth() + 1).padStart(2, '0') + '-'
    + String(d.getDate()).padStart(2, '0')
}

// ── Step config ───────────────────────────────────────────────────────────────

const STEPS = [
  { key: 'recap',    label: 'This week',  Icon: StatsIcon    },
  { key: 'overdue',  label: 'Overdue',    Icon: OverdueIcon  },
  { key: 'inbox',    label: 'Inbox',      Icon: InboxIcon    },
  { key: 'upcoming', label: 'Upcoming',   Icon: CalendarIcon },
  { key: 'someday',  label: 'Someday',    Icon: ArchiveIcon  },
  { key: 'done',     label: 'Done',       Icon: DoneIcon     },
] as const

// ── TaskTriageRow ─────────────────────────────────────────────────────────────

interface TriageRowProps {
  task: Task & { project: Project }
  actions: { label: string; emoji: string; action: () => void; color?: string }[]
  triaged: boolean
}

function TaskTriageRow({ task, actions, triaged }: TriageRowProps) {
  if (triaged) return null
  const est = task.adjusted_minutes ?? task.estimated_minutes

  return (
    <div className="flex items-start gap-3 py-3 border-b border-slate-100 dark:border-slate-800 last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-800 dark:text-slate-200 leading-snug">{task.title}</p>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <span
            className="text-xs font-medium px-1.5 py-0.5 rounded"
            style={{ background: task.project.color + '18', color: task.project.color }}
          >
            {task.project.name}
          </span>
          {est && <span className="text-xs text-slate-400 font-mono">{formatMinutes(est)}</span>}
          {task.due_date && (
            <span className={`text-xs font-medium ${task.due_date.slice(0, 10) < localToday() ? 'text-red-500' : 'text-slate-400'}`}>
              {formatDate(task.due_date)}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {actions.map(a => (
          <button
            key={a.label}
            onClick={a.action}
            title={a.label}
            className={`text-xs px-2.5 py-1.5 rounded-lg border font-medium transition-colors
              ${a.color ?? 'border-slate-200 dark:border-slate-700 text-slate-500 hover:border-slate-300 dark:hover:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800'}`}
          >
            {a.emoji} {a.label}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Step wrapper ──────────────────────────────────────────────────────────────

function StepShell({ title, sub, children, onNext, nextLabel = 'Next →', canSkip = true, onSkip }: {
  title: string
  sub: string
  children: React.ReactNode
  onNext: () => void
  nextLabel?: string
  canSkip?: boolean
  onSkip?: () => void
}) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
        <p className="text-sm text-slate-400 mt-0.5">{sub}</p>
      </div>
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl px-5 py-1">
        {children}
      </div>
      <div className="flex gap-2">
        {canSkip && onSkip && (
          <button onClick={onSkip} className="text-xs text-slate-400 hover:text-slate-600 px-3 py-2">
            Skip step
          </button>
        )}
        <button
          onClick={onNext}
          className="flex-1 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-xl py-2.5 text-sm font-semibold hover:opacity-80 transition-opacity"
        >
          {nextLabel}
        </button>
      </div>
    </div>
  )
}

// ── Recap step ────────────────────────────────────────────────────────────────

function RecapStep({ completed, weekStart, onNext }: {
  completed: (Task & { project: Project })[]
  weekStart: string
  onNext: () => void
}) {
  const totalActual = completed.reduce((s, t) => s + (t.actual_minutes ?? 0), 0)

  return (
    <StepShell
      title="This week's recap"
      sub={`Week of ${formatDate(weekStart)}`}
      onNext={onNext}
      nextLabel="Start review →"
      canSkip={false}
    >
      {completed.length === 0 ? (
        <p className="text-sm text-slate-400 italic text-center py-8">No tasks completed this week yet.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 py-4 border-b border-slate-100 dark:border-slate-800">
            <div className="text-center">
              <p className="text-3xl font-semibold text-accent-500">{completed.length}</p>
              <p className="text-xs text-slate-400 mt-0.5">tasks completed</p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-semibold text-slate-900 dark:text-slate-100">
                {totalActual ? formatMinutes(totalActual) : '—'}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">time logged</p>
            </div>
          </div>
          {completed.map(t => (
            <div key={t.id} className="flex items-center gap-2 py-2.5 border-b border-slate-100 dark:border-slate-800 last:border-0">
              <span className="text-accent-500 text-sm">✓</span>
              <span className="flex-1 text-sm text-slate-700 dark:text-slate-300 truncate">{t.title}</span>
              <span
                className="text-xs font-medium px-1.5 py-0.5 rounded shrink-0"
                style={{ background: t.project.color + '18', color: t.project.color }}
              >
                {t.project.name}
              </span>
            </div>
          ))}
        </>
      )}
    </StepShell>
  )
}

// ── Triage step (reusable for overdue / inbox / upcoming / someday) ───────────

type TriageVariant = 'overdue' | 'inbox' | 'upcoming' | 'someday'

const VARIANT_CONFIG: Record<TriageVariant, {
  title: string
  sub: string
  emptyMsg: string
  actions: (id: string, triage: (id: string, action: 'done' | 'someday' | 'cancel' | 'activate') => void) => { label: string; emoji: string; action: () => void; color?: string }[]
}> = {
  overdue: {
    title: 'Overdue tasks',
    sub: 'These missed their deadline. Mark done, push to someday, or cancel.',
    emptyMsg: 'No overdue tasks',
    actions: (id, triage) => [
      { label: 'Done', emoji: '✓', action: () => triage(id, 'done'),    color: 'border-accent-200 dark:border-accent-800 text-accent-600 dark:text-accent-400 hover:bg-accent-50 dark:hover:bg-accent-950' },
      { label: 'Someday', emoji: '→', action: () => triage(id, 'someday') },
      { label: 'Cancel', emoji: '✕', action: () => triage(id, 'cancel'),  color: 'border-red-100 dark:border-red-900 text-red-400 hover:bg-red-50 dark:hover:bg-red-950' },
    ],
  },
  inbox: {
    title: 'Inbox — unassigned tasks',
    sub: 'Route these to a project, or move to someday/cancel.',
    emptyMsg: 'Inbox is clear',
    actions: (id, triage) => [
      { label: 'Done', emoji: '✓', action: () => triage(id, 'done'),    color: 'border-accent-200 dark:border-accent-800 text-accent-600 dark:text-accent-400 hover:bg-accent-50 dark:hover:bg-accent-950' },
      { label: 'Someday', emoji: '→', action: () => triage(id, 'someday') },
      { label: 'Cancel', emoji: '✕', action: () => triage(id, 'cancel'),  color: 'border-red-100 dark:border-red-900 text-red-400 hover:bg-red-50 dark:hover:bg-red-950' },
    ],
  },
  upcoming: {
    title: 'Due in the next 7 days',
    sub: 'Confirm these are on track or push them out.',
    emptyMsg: 'Nothing due this week',
    actions: (id, triage) => [
      { label: 'Done', emoji: '✓', action: () => triage(id, 'done'),    color: 'border-accent-200 dark:border-accent-800 text-accent-600 dark:text-accent-400 hover:bg-accent-50 dark:hover:bg-accent-950' },
      { label: 'Someday', emoji: '→', action: () => triage(id, 'someday') },
    ],
  },
  someday: {
    title: 'Someday / maybe',
    sub: 'Activate anything that should move to this week, or let it rest.',
    emptyMsg: 'Someday list is empty',
    actions: (id, triage) => [
      { label: 'Activate', emoji: '↑', action: () => triage(id, 'activate'), color: 'border-violet-200 dark:border-violet-800 text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-950' },
      { label: 'Cancel', emoji: '✕', action: () => triage(id, 'cancel'),   color: 'border-red-100 dark:border-red-900 text-red-400 hover:bg-red-50 dark:hover:bg-red-950' },
    ],
  },
}

function TriageStep({ variant, tasks, onNext }: {
  variant: TriageVariant
  tasks: (Task & { project: Project })[]
  onNext: () => void
}) {
  const [triaged, setTriaged] = useState<Set<string>>(new Set())
  const [, startTransition] = useTransition()
  const cfg = VARIANT_CONFIG[variant]

  function triage(id: string, action: 'done' | 'someday' | 'cancel' | 'activate') {
    setTriaged(prev => new Set([...prev, id]))
    startTransition(async () => { await triageTask(id, action) })
  }

  const remaining = tasks.filter(t => !triaged.has(t.id))

  return (
    <StepShell
      title={cfg.title}
      sub={cfg.sub}
      onNext={onNext}
      canSkip={remaining.length === 0}
      onSkip={onNext}
    >
      {tasks.length === 0 || remaining.length === 0 ? (
        <p className="text-sm text-slate-400 italic text-center py-8">{cfg.emptyMsg}</p>
      ) : (
        remaining.map(task => (
          <TaskTriageRow
            key={task.id}
            task={task}
            triaged={triaged.has(task.id)}
            actions={cfg.actions(task.id, triage)}
          />
        ))
      )}
    </StepShell>
  )
}

// ── Done step ─────────────────────────────────────────────────────────────────

function DoneStep({ data, onSave }: { data: ReviewData; onSave: (notes: string) => void }) {
  const [notes, setNotes] = useState('')
  const [isPending, startTransition] = useTransition()

  function handleSave() {
    startTransition(async () => {
      await saveWeeklyReview({
        week_start: data.weekStart.slice(0, 10),
        completed_count: data.weeklyCompleted.length,
        postponed_count: data.someday.length,
        notes: notes || null,
      })
      onSave(notes)
    })
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="flex items-center justify-center gap-2 text-lg font-semibold text-slate-900 dark:text-slate-100">
            <CelebrateIcon size={18} className="text-accent-500" /> Review complete
          </h2>
        <p className="text-sm text-slate-400 mt-0.5">Add any notes for next week, then save.</p>
      </div>
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 flex flex-col gap-4">
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <p className="text-2xl font-semibold text-accent-500">{data.weeklyCompleted.length}</p>
            <p className="text-xs text-slate-400 mt-0.5">completed</p>
          </div>
          <div>
            <p className="text-2xl font-semibold text-violet-500">{data.someday.length}</p>
            <p className="text-xs text-slate-400 mt-0.5">in someday</p>
          </div>
          <div>
            <p className="text-2xl font-semibold text-amber-500">{data.upcoming.length}</p>
            <p className="text-xs text-slate-400 mt-0.5">due soon</p>
          </div>
        </div>
        <div className="border-t border-slate-100 dark:border-slate-800 pt-4">
          <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">
            Notes for next week (optional)
          </label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={3}
            placeholder="What to focus on, blockers to clear, intentions…"
            className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200 resize-none focus:outline-none focus:ring-2 focus:ring-accent-500"
          />
        </div>
      </div>
      <button
        onClick={handleSave}
        disabled={isPending}
        className="w-full bg-accent-500 hover:bg-accent-600 text-white rounded-xl py-3 text-sm font-semibold transition-colors disabled:opacity-50"
      >
        {isPending ? 'Saving…' : '✓ Save weekly review'}
      </button>
    </div>
  )
}

// ── Saved confirmation ────────────────────────────────────────────────────────

function SavedScreen() {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
      <DoneIcon size={40} className="mx-auto text-accent-500" />
      <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">All done for this week</h2>
      <p className="text-sm text-slate-400 max-w-xs">
        Your review is saved. Check back at the start of next week to run it again.
      </p>
    </div>
  )
}

// ── Progress bar ──────────────────────────────────────────────────────────────

function StepProgress({ steps, current }: { steps: typeof STEPS; current: number }) {
  return (
    <div className="flex items-center gap-1 mb-6">
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-center gap-1 flex-1">
          <div className={`h-1 flex-1 rounded-full transition-colors ${
            i < current  ? 'bg-accent-500' :
            i === current ? 'bg-slate-900 dark:bg-white' :
            'bg-slate-200 dark:bg-slate-700'
          }`} />
          {i < steps.length - 1 && (
            <div className={`w-1.5 h-1.5 rounded-full shrink-0 transition-colors ${
              i < current ? 'bg-accent-500' : 'bg-slate-200 dark:bg-slate-700'
            }`} />
          )}
        </div>
      ))}
    </div>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────────

/** The current step's icon and label — the icon is a component, so it needs a
 *  capitalised binding before JSX will render it. */
function StepLabel({ step }: { step: number }) {
  const { Icon, label } = STEPS[step]
  return (
    <span className="flex items-center gap-1.5 text-xs text-slate-400">
      <Icon size={13} /> {label} · {step + 1}/{STEPS.length}
    </span>
  )
}

export default function ReviewView({ data }: { data: ReviewData }) {
  const [step, setStep] = useState(0)
  const [saved, setSaved] = useState(false)
  const [showAddTask, setShowAddTask] = useState(false)

  const next = () => setStep(s => Math.min(s + 1, STEPS.length - 1))

  const stepContent = () => {
    switch (STEPS[step].key) {
      case 'recap':
        return <RecapStep completed={data.weeklyCompleted} weekStart={data.weekStart} onNext={next} />
      case 'overdue':
        return <TriageStep variant="overdue" tasks={data.overdue} onNext={next} />
      case 'inbox':
        return <TriageStep variant="inbox" tasks={data.inbox} onNext={next} />
      case 'upcoming':
        return <TriageStep variant="upcoming" tasks={data.upcoming} onNext={next} />
      case 'someday':
        return <TriageStep variant="someday" tasks={data.someday} onNext={next} />
      case 'done':
        return <DoneStep data={data} onSave={() => setSaved(true)} />
    }
  }

  return (
    <>
      <div className="min-h-full bg-slate-50 dark:bg-slate-950">
        <header className="sticky top-0 z-10 border-b border-slate-200 dark:border-slate-800 bg-white/90 dark:bg-slate-900/90 backdrop-blur">
          <div className="px-6 py-3 flex items-center justify-between">
            <h1 className="page-title text-ink">Weekly review</h1>
            <div className="flex items-center gap-3">
              <StepLabel step={step} />
              <button
                onClick={() => setShowAddTask(true)}
                className="text-xs bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-3 py-1.5 rounded-lg font-medium hover:opacity-80 transition-opacity"
              >
                + Add task
              </button>
            </div>
          </div>
        </header>

        <div className="max-w-xl mx-auto px-6 py-6">
          {saved ? (
            <SavedScreen />
          ) : (
            <>
              <StepProgress steps={STEPS} current={step} />
              {stepContent()}
            </>
          )}
        </div>
      </div>

      {showAddTask && (
        <AddTaskModal
          projects={data.projects}
          onClose={() => setShowAddTask(false)}
          onCreated={() => setShowAddTask(false)}
        />
      )}
    </>
  )
}
