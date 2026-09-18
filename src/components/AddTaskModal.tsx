'use client'

import { useState, useEffect, useRef, useMemo, useTransition } from 'react'
import { Project, EnergyLevel, UrgencyCurve } from '@/types'
import { createTask } from '@/app/actions/tasks'
import ProjectPicker from '@/components/ProjectPicker'
import RecurrencePicker from '@/components/RecurrencePicker'
import QuickAddInput from '@/components/QuickAddInput'
import { rruleToLabel } from '@/lib/rrule-utils'
import { parseQuickAdd } from '@/lib/quick-add'
import { DEFAULT_TZ, isValidTimezone } from '@/lib/day'

interface ParsedResult {
  title: string
  due_date: string | null
  estimated_minutes: number | null
  energy_required: EnergyLevel
  project_hint: string | null
  project_id: string | null
  is_calendar_event: boolean
}

const ENERGY_ICON: Record<EnergyLevel, string> = { low: '🌿', medium: '⚡', high: '🔥' }
const PRIORITY_LABELS = ['', 'Low', 'Medium', 'High', 'Critical'] as const

const CURVE_OPTS: { val: UrgencyCurve; label: string; desc: string }[] = [
  { val: 'linear',      label: 'Linear',      desc: 'Pressure builds evenly as the deadline approaches.' },
  { val: 'exponential', label: 'Exponential', desc: 'Quiet until late, then climbs sharply.' },
  { val: 'step',        label: 'Step',        desc: 'Nothing, then suddenly everything, near the day.' },
]

const LOCATION_OPTS = [
  { val: 'anywhere', label: 'Anywhere', icon: '◎' },
  { val: 'home',     label: 'Home',     icon: '⌂' },
  { val: 'away',     label: 'Out',      icon: '↗' },
] as const

const BUFFER_OPTS: { val: number | null; label: string }[] = [
  { val: null, label: 'Default' },
  { val: 0,    label: 'None' },
  { val: 5,    label: '5m' },
  { val: 30,   label: '30m' },
]

const DETAIL_KEY = 'planner.addTask.detailed'

function storedDetailed(): boolean {
  if (typeof window === 'undefined') return false
  try { return window.localStorage.getItem(DETAIL_KEY) === '1' } catch { return false }
}

interface Props {
  projects: Project[]
  initialProjectId?: string
  initialDueDate?: string
  defaultType?: 'task' | 'habit'
  onClose: () => void
  onCreated: () => void
}

export default function AddTaskModal({ projects, initialProjectId, initialDueDate, defaultType, onClose, onCreated }: Props) {
  // Task vs Habit mode
  const [mode, setMode] = useState<'task' | 'habit'>(defaultType ?? 'task')

  // Compact vs detailed. Remembered across adds — someone who reaches for the
  // advanced fields once usually wants them next time too, and re-opening to
  // compact every time makes the detailed view feel like it never sticks.
  const [detailed, setDetailed] = useState(storedDetailed)
  function chooseView(v: boolean) {
    setDetailed(v)
    try { window.localStorage.setItem(DETAIL_KEY, v ? '1' : '0') } catch { /* private mode */ }
  }

  const [text, setText]             = useState('')
  const [parsed, setParsed]         = useState<ParsedResult | null>(null)
  const [parsing, setParsing]       = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)

  // Editable fields (populated from parsed result)
  const [title, setTitle]       = useState('')
  const [projectId, setProject] = useState(initialProjectId ?? '')
  const [priority, setPriority] = useState<1|2|3|4>(2)
  const [energy, setEnergy]     = useState<EnergyLevel>('medium')
  const [estimate, setEstimate] = useState('')
  // Seeded from the prop rather than synced into state by an effect. The modal
  // is mounted fresh each time it opens — Upcoming's "+ Add task" passes the day
  // of the column it was clicked from — so the initial value is the whole job,
  // and copying a prop into state on every change is the pattern React warns
  // about: two sources for one value, and a render with the wrong one first.
  const [dueDate, setDueDate]   = useState(initialDueDate ?? '')
  /** "HH:MM" wall-clock, or '' for all-day. Stored as minutes from midnight. */
  const [dueTime, setDueTime]   = useState('')
  /** `every!` — advance the chain from completion rather than from the due date. */
  const [fromCompletion, setFromCompletion] = useState(false)

  const [rrule, setRrule] = useState<string | null>(null)

  const [weeklyTarget, setWeeklyTarget] = useState<string>('')

  // ── Advanced ──
  const [description, setDescription] = useState('')
  const [startDate,   setStartDate]   = useState('')
  const [location,    setLocation]    = useState<string>('anywhere')
  const [span,        setSpan]        = useState('')
  const [buffer,      setBuffer]      = useState<number | null>(null)
  const [curve,       setCurve]       = useState<UrgencyCurve>('linear')
  const [avoidBreaks, setAvoidBreaks] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)


  const [isPending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  /**
   * The browser's own zone — the same value TimezoneSync reports to the server,
   * so quick-add resolves "tomorrow" against the days the rest of the app
   * counts in. Read once: it cannot change mid-modal, and reading it during
   * render would differ between server and client.
   */
  const tz = useMemo(() => {
    const browser = Intl.DateTimeFormat().resolvedOptions().timeZone
    return isValidTimezone(browser) ? browser : DEFAULT_TZ
  }, [])

  /**
   * Runs on every keystroke. It is pure string work against an injected clock —
   * no network, no database — which is what lets the field highlight as you
   * type rather than after a round trip.
   */
  const quick = useMemo(() => parseQuickAdd(text, { tz }), [text, tz])

  /** Apply what the grammar found. Instant, and the Enter key's whole job. */
  function applyQuickAdd() {
    if (!quick.title && !quick.dueDay && !quick.rrule) return
    if (quick.title)  setTitle(quick.title)
    if (quick.dueISO) setDueDate(quick.dueISO.slice(0, 10))
    // A repeat typed in the text wins over one left behind by a previous add:
    // "every monday" is an instruction, not a suggestion.
    if (quick.rrule)  setRrule(quick.rrule)
    if (quick.timeMinutes !== null) {
      const h = Math.floor(quick.timeMinutes / 60), m = quick.timeMinutes % 60
      setDueTime(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
    }
    if (quick.recurrenceFromCompletion) setFromCompletion(true)
    setParsed(null)
    setParseError(null)
    inputRef.current?.focus()
  }

  useEffect(() => {
    inputRef.current?.focus()
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  async function handleParse() {
    if (!text.trim()) return
    setParsing(true)
    setParseError(null)
    try {
      const res = await fetch('/api/parse-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, projects: projects.map(p => ({ id: p.id, name: p.name })) }),
      })
      if (!res.ok) throw new Error('Parse failed')
      const data: ParsedResult = await res.json()
      setParsed(data)
      // Pre-fill editable fields
      setTitle(data.title)
      if (data.project_id) setProject(data.project_id)
      setEnergy(data.energy_required ?? 'medium')
      if (data.estimated_minutes) setEstimate(String(data.estimated_minutes))
      if (data.due_date) setDueDate(data.due_date)
    } catch {
      setParseError('Could not parse — please fill fields manually')
      setParsed(null)
      setTitle(text.trim())
    } finally {
      setParsing(false)
    }
  }

  /**
   * What's set behind the compact view.
   *
   * Quick-add can fill an advanced field (energy, most often) and a remembered
   * detailed session can leave one set, so compact mode says what it's about to
   * apply. Hidden is fine; hidden *and* silently in effect isn't.
   */
  const hiddenSummary: string[] = (() => {
    if (detailed) return []
    const out: string[] = []
    if (mode === 'task') {
      if (energy !== 'medium') out.push(`${ENERGY_ICON[energy]} ${energy} energy`)
      if (rrule)               out.push(`↻ ${rruleToLabel(rrule)}`)
      if (rrule && fromCompletion) out.push('repeats from completion')
      if (dueTime)             out.push(`at ${dueTime}`)
      if (startDate)           out.push(`not before ${startDate}`)
      if (curve !== 'linear')  out.push(`${curve} urgency`)
    } else {
      if (priority !== 2) out.push(`priority ${priority}`)
      if (rrule)          out.push(`↻ ${rruleToLabel(rrule)}`)
      if (avoidBreaks)    out.push('not after meals')
    }
    if (location !== 'anywhere') out.push(location === 'home' ? '⌂ at home' : '↗ out')
    if (span)                    out.push(`ties me up ${span}m`)
    if (buffer !== null)         out.push(buffer === 0 ? 'no buffer' : `${buffer}m buffer`)
    return out
  })()

  function handleCreate() {
    if (!title.trim()) return
    setCreateError(null)
    startTransition(async () => {
      try {
        await createTask({
          title: title.trim(),
          project_id: mode === 'habit' ? null : projectId,
          priority,
          energy_required: energy,
          estimated_minutes: estimate ? parseInt(estimate) : null,
          due_date: mode === 'habit' ? null : (dueDate ? new Date(dueDate).toISOString() : null),
          urgency_curve: mode === 'habit' ? 'linear' : curve,
          rrule: rrule || null,
          weekly_target: mode === 'habit' && weeklyTarget ? parseInt(weeklyTarget) : null,
          taskType: mode === 'habit' ? 'habit' : undefined,
          description: description.trim() || null,
          // Habits have no deadline, so "not before" has nothing to sit against.
          start_date: mode === 'habit' || !startDate ? null : new Date(startDate).toISOString(),
          location,
          span_minutes: span ? parseInt(span) : null,
          buffer_minutes: buffer,
          avoid_after_breaks: mode === 'habit' && avoidBreaks,
          due_time_minutes: mode === 'habit' || !dueDate || !dueTime
            ? null
            : Number(dueTime.slice(0, 2)) * 60 + Number(dueTime.slice(3, 5)),
          rrule_from_completion: !!rrule && fromCompletion,
        })
        onCreated()
      } catch (err) {
        // An advanced field whose migration hasn't been run fails the whole
        // insert — say which, instead of leaving a dead button.
        setCreateError(err instanceof Error ? err.message : 'Could not create')
      }
    })
  }

  const fieldClass = 'w-full border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-accent-500'
  const labelClass = 'block text-xs font-medium text-slate-400 uppercase tracking-wide mb-1.5'

  /** Where / ties-me-up / buffer — the placement block, shared by both modes. */
  function placementFields(accent: 'accent' | 'violet') {
    const on = accent === 'violet'
      ? 'bg-violet-600 border-violet-600 text-white'
      : 'bg-slate-900 dark:bg-white border-slate-900 dark:border-white text-white dark:text-slate-900'
    return (
      <div>
        <label className={labelClass}>Where</label>
        <div className="flex gap-1.5">
          {LOCATION_OPTS.map(o => (
            <button
              key={o.val}
              type="button"
              onClick={() => setLocation(o.val)}
              className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                location === o.val ? on : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:border-slate-300'
              }`}
            >
              {o.icon} {o.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 mt-2">
          <span className="text-xs text-slate-400 shrink-0">Ties me up for</span>
          <input
            type="number" min={1} step={15} value={span} placeholder="—"
            onChange={e => setSpan(e.target.value)}
            className="w-20 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 text-xs bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-accent-500 font-mono"
          />
          <span className="text-xs text-slate-400">min total</span>
        </div>
        <p className="text-[11px] text-slate-400 mt-1">
          For things like laundry: only the estimate is booked, but you stay put for
          the full time and nothing that needs you elsewhere is scheduled into it.
        </p>

        <div className="flex items-center gap-2 mt-3">
          <span className="text-xs text-slate-400 shrink-0">Buffer</span>
          <div className="flex gap-1">
            {BUFFER_OPTS.map(o => (
              <button
                key={String(o.val)}
                type="button"
                onClick={() => setBuffer(o.val)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                  buffer === o.val ? on : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:border-slate-300'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
        <p className="text-[11px] text-slate-400 mt-1">
          Transition time kept clear around this. Set None for quick chores — otherwise
          a 5-minute job needs half an hour of free space to fit.
        </p>
      </div>
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-slate-950/40 dark:bg-slate-950/60" />

      <div
        className="relative w-full max-w-lg max-h-[88vh] bg-white dark:bg-slate-900 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header: what am I adding, and how much of the form do I want ── */}
        <div className="px-5 pt-5 pb-4 flex items-center justify-between gap-3 shrink-0">
          <div className="flex gap-0.5 bg-slate-100 dark:bg-slate-800 rounded-xl p-0.5 w-fit">
            {(['task', 'habit'] as const).map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors capitalize ${
                  mode === m
                    ? m === 'habit'
                      ? 'bg-violet-600 text-white'
                      : 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
              >
                {m === 'habit' ? '↻ Habit' : '✓ Task'}
              </button>
            ))}
          </div>

          <div className="flex gap-0.5 bg-slate-100 dark:bg-slate-800 rounded-xl p-0.5 w-fit">
            {([false, true] as const).map(v => (
              <button
                key={String(v)}
                onClick={() => chooseView(v)}
                title={v ? 'Every field' : 'Just the essentials'}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  detailed === v
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
              >
                {v ? 'Detailed' : 'Compact'}
              </button>
            ))}
          </div>
        </div>

        {/* ── Fields ── */}
        <div className="flex-1 overflow-y-auto">
        {mode === 'task' ? (
          <>
            {/* Quick add — the fastest path in either view */}
            <div className="px-5">
              <div className="flex items-baseline justify-between mb-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-accent-600 dark:text-accent-400">
                  ✦ Quick add
                </p>
                <a
                  href="/help/quick-add"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-slate-400 hover:text-accent-600 dark:hover:text-accent-400 transition-colors"
                >
                  Syntax ↗
                </a>
              </div>
              <QuickAddInput
                value={text}
                onChange={v => { setText(v); setParsed(null) }}
                onSubmit={applyQuickAdd}
                tokens={quick.tokens}
                placeholder="e.g. Submit CS homework by Friday, 45 min, high energy"
              />

              {/* What the grammar read back, so it can be checked before it is
                  applied. A highlight says "this was recognised"; the chip says
                  what it was recognised *as*, which is the part that can be
                  wrong — "3/4" is two different days on either side of an
                  ocean. */}
              {quick.tokens.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                  {quick.tokens.map((t, i) => (
                    <span
                      key={i}
                      className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-accent-50 dark:bg-accent-500/15 text-accent-700 dark:text-accent-300"
                    >
                      {t.label}
                    </span>
                  ))}
                  {quick.title && (
                    <span className="text-[11px] text-slate-400 truncate">
                      → {quick.title}
                    </span>
                  )}
                </div>
              )}

              <div className="flex justify-between items-center mt-2 mb-3">
                <p className="text-xs text-slate-400">
                  {parsed
                    ? '✓ Parsed — review below'
                    : quick.tokens.length > 0
                      ? 'Enter to apply'
                      : 'Enter to apply · Parse for energy, project and estimate'}
                </p>
                <button
                  onClick={handleParse}
                  disabled={!text.trim() || parsing}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg bg-accent-500 text-white hover:bg-accent-600 disabled:opacity-40 transition-colors"
                >
                  {parsing ? 'Parsing…' : '✦ Parse'}
                </button>
              </div>
              {parseError && <p className="text-xs text-amber-500 mb-3">{parseError}</p>}
            </div>

            <div className="border-t border-slate-100 dark:border-slate-800" />

            <div className="p-5 flex flex-col gap-4">
              {/* ── Essentials ── */}
              <div>
                <label className={labelClass}>Title</label>
                <input
                  ref={inputRef}
                  type="text"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !detailed) handleCreate() }}
                  placeholder="Task title"
                  className={fieldClass}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Project</label>
                  <ProjectPicker projects={projects} value={projectId} onChange={setProject} />
                </div>
                <div>
                  <label className={labelClass}>Priority</label>
                  <div className="flex gap-1">
                    {([1, 2, 3, 4] as const).map(p => (
                      <button key={p} onClick={() => setPriority(p)}
                        className={`flex-1 py-2 rounded-lg text-xs font-medium border transition-colors ${priority === p ? 'bg-slate-900 dark:bg-white border-slate-900 dark:border-white text-white dark:text-slate-900' : 'border-slate-200 dark:border-slate-700 text-slate-400 hover:border-slate-300'}`}
                        title={PRIORITY_LABELS[p]}>{p}</button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Estimate (min)</label>
                  <input type="number" min={1} value={estimate} onChange={e => setEstimate(e.target.value)} placeholder="e.g. 45"
                    className={`${fieldClass} font-mono`} />
                </div>
                <div>
                  <label className={labelClass}>Due date</label>
                  <div className="flex gap-1.5">
                    <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className={fieldClass} />
                    {/* A wall-clock time, kept beside the day rather than folded
                        into it — see migration 0015. Disabled without a day,
                        since an hour with no date has nothing to happen on. */}
                    <input
                      type="time"
                      value={dueTime}
                      disabled={!dueDate}
                      onChange={e => setDueTime(e.target.value)}
                      className={`${fieldClass} w-28 font-mono disabled:opacity-40`}
                      aria-label="Due time"
                    />
                  </div>
                </div>
              </div>

              {/* ── Everything else ── */}
              {detailed && (
                <>
                  <div>
                    <label className={labelClass}>Notes</label>
                    <textarea
                      value={description}
                      onChange={e => setDescription(e.target.value)}
                      rows={2}
                      placeholder="Anything you'll want in front of you when you sit down to it"
                      className={`${fieldClass} resize-none`}
                    />
                  </div>

                  <div>
                    <label className={labelClass}>Energy required</label>
                    <div className="flex gap-1.5">
                      {(['low', 'medium', 'high'] as const).map(e => (
                        <button key={e} onClick={() => setEnergy(e)}
                          className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors ${energy === e ? 'bg-slate-900 dark:bg-white border-slate-900 dark:border-white text-white dark:text-slate-900' : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:border-slate-300'}`}>
                          {ENERGY_ICON[e]} {e}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className={labelClass}>Repeat</label>
                    <RecurrencePicker value={rrule} onChange={setRrule} />
                  </div>

                  <div>
                    <label className={labelClass}>Not before</label>
                    <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className={fieldClass} />
                    <p className="text-[11px] text-slate-400 mt-1">
                      Won't be scheduled before this, however much free time there is.
                      Recurring tasks set it themselves so the next one isn't pulled forward.
                    </p>
                  </div>

                  {placementFields('accent')}

                  <div>
                    <label className={labelClass}>Urgency curve</label>
                    <div className="flex flex-col gap-1.5">
                      {CURVE_OPTS.map(o => (
                        <button
                          key={o.val}
                          onClick={() => setCurve(o.val)}
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
                </>
              )}
            </div>
          </>
        ) : (
          /* ── Habit ── */
          <div className="p-5 pt-0 flex flex-col gap-4">
            <div>
              <label className={labelClass}>Habit name</label>
              <input
                ref={inputRef}
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !detailed) handleCreate() }}
                placeholder="e.g. Gym, Run, Meditate, Read"
                className="w-full border border-violet-200 dark:border-violet-800 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Times per week</label>
                <div className="flex gap-1">
                  {[2, 3, 4, 5].map(n => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setWeeklyTarget(weeklyTarget === String(n) ? '' : String(n))}
                      className={`flex-1 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                        weeklyTarget === String(n)
                          ? 'bg-violet-600 border-violet-600 text-white'
                          : 'border-slate-200 dark:border-slate-700 text-slate-400 hover:border-violet-300 hover:text-violet-500'
                      }`}
                    >
                      {n}×
                    </button>
                  ))}
                </div>
                <input
                  type="number" min={1} max={7} value={weeklyTarget}
                  onChange={e => setWeeklyTarget(e.target.value)}
                  placeholder="or type a number"
                  className="mt-1.5 w-full border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-violet-500 font-mono placeholder:text-slate-300"
                />
              </div>
              <div>
                <label className={labelClass}>Session length</label>
                <div className="flex gap-1">
                  {[30, 45, 60, 90].map(n => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setEstimate(estimate === String(n) ? '' : String(n))}
                      className={`flex-1 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                        estimate === String(n)
                          ? 'bg-violet-600 border-violet-600 text-white'
                          : 'border-slate-200 dark:border-slate-700 text-slate-400 hover:border-violet-300 hover:text-violet-500'
                      }`}
                    >
                      {n}m
                    </button>
                  ))}
                </div>
                <input
                  type="number" min={5} step={5} value={estimate}
                  onChange={e => setEstimate(e.target.value)}
                  placeholder="minutes"
                  className="mt-1.5 w-full border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-violet-500 font-mono placeholder:text-slate-300"
                />
              </div>
            </div>

            <p className="text-xs text-slate-400">
              {weeklyTarget && estimate
                ? `Scheduling your week will book ${weeklyTarget} × ${estimate}m sessions on separate days.`
                : 'Set a weekly target and session length to have this booked into your schedule automatically.'}
            </p>

            {detailed && (
              <>
                <div>
                  <label className={labelClass}>Notes</label>
                  <textarea
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    rows={2}
                    placeholder="Routine, gear, anything worth remembering"
                    className={`${fieldClass} resize-none`}
                  />
                </div>

                <div>
                  <label className={labelClass}>Priority</label>
                  <div className="flex gap-1">
                    {([1, 2, 3, 4] as const).map(p => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setPriority(p)}
                        title={PRIORITY_LABELS[p]}
                        className={`flex-1 py-2 rounded-lg text-xs font-medium border transition-colors ${
                          priority === p
                            ? 'bg-violet-600 border-violet-600 text-white'
                            : 'border-slate-200 dark:border-slate-700 text-slate-400 hover:border-violet-300'
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Habits have no deadline, so priority is what decides which one gets
                    the good slot when the week is tight.
                  </p>
                </div>

                <div>
                  <label className={labelClass}>Energy required</label>
                  <div className="flex gap-1.5">
                    {(['low', 'medium', 'high'] as const).map(e => (
                      <button key={e} onClick={() => setEnergy(e)}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                          energy === e
                            ? 'bg-violet-600 border-violet-600 text-white'
                            : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:border-violet-300'
                        }`}>
                        {ENERGY_ICON[e]} {e}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className={labelClass}>
                    Schedule
                    {!rrule && <span className="ml-1 normal-case text-violet-500 font-normal">● Any day</span>}
                  </label>
                  <RecurrencePicker value={rrule} onChange={setRrule} />
                </div>

                <div>
                  <label className={labelClass}>Meals</label>
                  <button
                    type="button"
                    onClick={() => setAvoidBreaks(v => !v)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg border text-left transition-colors ${
                      avoidBreaks
                        ? 'bg-violet-600 border-violet-600 text-white'
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-violet-300'
                    }`}
                  >
                    <span className="text-sm shrink-0">{avoidBreaks ? '☑' : '☐'}</span>
                    <span className="text-xs leading-snug">
                      Not for an hour after a meal — for anything strenuous, like a gym
                      session or a run.
                    </span>
                  </button>
                </div>

                {placementFields('violet')}

                <p className="text-[11px] text-slate-400">
                  Habits that shouldn't share a day — gym and running, say — are paired
                  on the <a href="/habits" className="underline hover:text-violet-500">habits page</a>,
                  where you can pick from the ones you already have.
                </p>
              </>
            )}
          </div>
        )}
        </div>

        {/* ── Actions ── */}
        <div className="px-5 pb-5 pt-3 shrink-0 border-t border-slate-100 dark:border-slate-800">
          {hiddenSummary.length > 0 && (
            <p className="text-[11px] text-slate-400 mb-2">
              Also applying: {hiddenSummary.join(' · ')} —{' '}
              <button onClick={() => chooseView(true)} className="underline hover:text-accent-500">
                show detailed
              </button>
            </p>
          )}
          {createError && <p className="text-xs text-amber-500 mb-2">{createError}</p>}
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 py-2 px-3 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={!title.trim() || isPending}
              className={`flex-1 rounded-xl py-2.5 text-sm font-semibold hover:opacity-80 transition-opacity disabled:opacity-40 text-white ${
                mode === 'habit' ? 'bg-violet-600' : 'bg-slate-900 dark:bg-white dark:text-slate-900'
              }`}
            >
              {isPending ? 'Creating…' : mode === 'habit' ? '↻ Add habit' : '+ Add task'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
