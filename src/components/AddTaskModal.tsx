'use client'

import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from 'react'
import { ChevronDown, X } from 'lucide-react'
import { AiIcon, EnergyIcon } from '@/components/icons'
import type { EnergyLevel, Project, UrgencyCurve } from '@/types'
import { createTask } from '@/app/actions/tasks'
import ProjectPicker from '@/components/ProjectPicker'
import QuickAddInput from '@/components/quick-add/QuickAddInput'
import Receipt from '@/components/quick-add/Receipt'
import { parseQuickAdd, type QuickAddMiss } from '@/lib/quick-add'
import { fillBlanks, type ParsedTask } from '@/lib/parse-task'
import { PRESETS, rruleToLabel } from '@/lib/rrule-utils'
import { DEFAULT_TZ, isValidTimezone, todayStr } from '@/lib/day'
import { useStored, writeStored } from '@/lib/use-stored'
import {
  resolve, receipt, habitPlan, setValue, excludeSpans, guessFrom, toCreate, isDefault,
  daysOf, repeatFromDays, daysLabel, WEEKDAY_ORDER, GROUP,
  type Draft, type Key, type Mode, type Resolution, type Resolved, type Values, type Weekday, type Where,
  type ReceiptChip,
} from '@/lib/add-task-model'

/**
 * The single add surface for tasks and habits.
 *
 * **The sentence is the title field.** What the grammar understands lights up
 * in it and is listed underneath in words; everything else becomes the title.
 * Enter adds. There is no second title field and no "apply" step, because the
 * receipt and the rows under All fields are both read from the same
 * resolution of the text — see `lib/add-task-model`, which owns every
 * decision made here and is tested on its own.
 *
 * All fields shows one row per attribute and who set it: the fragment you
 * typed, a guess, set here, or the syntax you could type instead.
 */

const DETAIL_KEY = 'planner.addTask.detailed'
function readDetailed(): boolean {
  try { return window.localStorage.getItem(DETAIL_KEY) === '1' } catch { return false }
}

const PRIORITY: { v: 1 | 2 | 3 | 4; label: string; token: string }[] = [
  { v: 4, label: 'Critical', token: 'p1' },
  { v: 3, label: 'High',     token: 'p2' },
  { v: 2, label: 'Medium',   token: 'p3' },
  { v: 1, label: 'Low',      token: 'p4' },
]
const ENERGY: EnergyLevel[] = ['low', 'medium', 'high']
const WHERE: { v: Where; label: string }[] = [
  { v: 'anywhere', label: 'Anywhere' }, { v: 'home', label: 'Home' }, { v: 'away', label: 'Out' },
]
const BUFFER: { v: number | null; label: string }[] = [
  { v: null, label: 'Default' }, { v: 0, label: 'None' }, { v: 5, label: '5m' }, { v: 30, label: '30m' },
]
const CURVE: { v: UrgencyCurve; label: string; help: string; path: string }[] = [
  { v: 'linear',      label: 'Linear',      help: 'Pressure builds evenly towards the deadline.', path: 'M1 13 25 1' },
  { v: 'exponential', label: 'Exponential', help: 'Quiet until late, then climbs sharply.',       path: 'M1 13C15 13 21 10 25 1' },
  { v: 'step',        label: 'Step',        help: 'Nothing, then everything, near the day.',       path: 'M1 13H17V1H25' },
]
const DAY_LETTER: Record<Weekday, string> = { MO: 'M', TU: 'T', WE: 'W', TH: 'T', FR: 'F', SA: 'S', SU: 'S' }
const DAY_NAME: Record<Weekday, string> = { MO: 'Monday', TU: 'Tuesday', WE: 'Wednesday', TH: 'Thursday', FR: 'Friday', SA: 'Saturday', SU: 'Sunday' }

interface Props {
  projects: Project[]
  initialProjectId?: string
  initialDueDate?: string
  defaultType?: 'task' | 'habit'
  onClose: () => void
  onCreated: () => void
  /**
   * Where the task goes. The server action unless a preview says otherwise —
   * /auth/design renders this modal against fixtures, and pressing Add there
   * must not write to the real database.
   */
  save?: (data: ReturnType<typeof toCreate>) => Promise<unknown>
}

export default function AddTaskModal({ projects, initialProjectId, initialDueDate, defaultType, onClose, onCreated, save = createTask }: Props) {
  const [mode, setMode] = useState<Mode>(defaultType ?? 'task')
  const detailed = useStored(readDetailed, false)
  function chooseView(v: boolean) {
    writeStored(() => { try { window.localStorage.setItem(DETAIL_KEY, v ? '1' : '0') } catch { /* private mode */ } })
  }

  /**
   * The page that opened the modal can say which project and day it came
   * from. Those are settings like any other, so the receipt lists them and
   * their × clears them — a context that silently applies is the kind of
   * hidden setting this form exists to avoid.
   */
  const [draft, setDraft] = useState<Draft>(() => ({
    text: '',
    set: {
      ...(initialProjectId ? { project: initialProjectId } : {}),
      ...(initialDueDate ? { due: initialDueDate.slice(0, 10) } : {}),
    },
  }))
  const [kept, setKept]         = useState<string[]>([])
  const [guess, setGuess]       = useState<Partial<Values>>({})
  const [guessing, setGuessing] = useState<'idle' | 'loading' | 'error'>('idle')
  const [removed, setRemoved]   = useState<{ fragment: string; before: Draft } | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const narrow = useNarrow()
  const keyboard = useKeyboardInset()
  const inputRef = useRef<HTMLTextAreaElement>(null)

  /**
   * The browser's own zone — the same value TimezoneSync reports to the
   * server — so "tomorrow" means the day the rest of the app counts in.
   */
  const tz = useMemo(() => {
    const browser = Intl.DateTimeFormat().resolvedOptions().timeZone
    return isValidTimezone(browser) ? browser : DEFAULT_TZ
  }, [])
  const projectList = useMemo(() => projects.map(p => ({ id: p.id, name: p.name })), [projects])

  /** Pure string work against an injected clock, so it runs on every keystroke. */
  const parse = useMemo(
    () => parseQuickAdd(draft.text, {
      tz, projects: projectList, mode, exclude: excludeSpans(draft.text, kept),
    }),
    [draft.text, tz, projectList, mode, kept],
  )
  const r = useMemo(() => resolve(parse, draft.set, guess), [parse, draft.set, guess])
  const ctx = useMemo(() => ({ today: todayStr(tz), projects: projectList }), [tz, projectList])
  const chips = receipt(parse, r, mode, ctx, kept, detailed)
  const title = parse.title

  useEffect(() => {
    inputRef.current?.focus()
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  // ── Changes ────────────────────────────────────────────────────────────────

  function type(text: string) {
    setDraft(d => ({ ...d, text }))
    setKept(k => k.filter(f => text.includes(f)))
    setRemoved(null)
    if (guessing === 'error') setGuessing('idle')
  }

  function set<K extends Key>(k: K, v: Values[K]) {
    const next = setValue(draft, r, k, v)
    setDraft({ text: next.text, set: next.set })
    if (next.removed) {
      setRemoved(next.removed)
      setKept(ks => ks.filter(f => next.text.includes(f)))
    }
  }

  function clear(k: Key) {
    setDraft(d => {
      const s = { ...d.set }
      delete s[k]
      return { ...d, set: s }
    })
  }

  function dropGuess(k: Key) {
    setGuess(g => {
      const n = { ...g }
      delete n[k]
      return n
    })
  }

  function keep(fragment: string) {
    setKept(k => [...k, fragment])
  }

  function onChip(c: ReceiptChip) {
    if (c.kind === 'typed' && c.fragment) keep(c.fragment)
    else if (c.kind === 'kept' && c.fragment) setKept(k => k.filter(f => f !== c.fragment))
    else if (c.kind === 'set' && c.key) clear(c.key)
    else if (c.kind === 'guessed' && c.key) dropGuess(c.key)
    inputRef.current?.focus()
  }

  function fixMiss(m: QuickAddMiss, fixed: string) {
    type(draft.text.slice(0, m.start) + fixed + draft.text.slice(m.end))
    inputRef.current?.focus()
  }

  function undoRemoval() {
    if (!removed) return
    setDraft(removed.before)
    setRemoved(null)
  }

  function switchMode(m: Mode) {
    setMode(m)
    // The other mode reads different fragments, so "keep as words" choices
    // made for this one don't carry over.
    setKept([])
    setGuess({})
    setGuessing('idle')
    setRemoved(null)
  }

  /**
   * ✦ Guess the rest. Claude's answer only fills what the text and your
   * settings left empty: `fillBlanks` defers to the grammar, and the
   * resolution puts a guess below everything else.
   */
  async function guessRest() {
    if (!title) return
    setGuessing('loading')
    try {
      const res = await fetch('/api/parse-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: draft.text, projects: projectList }),
      })
      if (!res.ok) throw new Error('Parse failed')
      const data: ParsedTask = await res.json()
      setGuess(guessFrom(fillBlanks(parse, data), mode))
      setGuessing('idle')
    } catch {
      setGuessing('error')
    }
  }

  function add() {
    if (!title.trim() || isPending) return
    setCreateError(null)
    startTransition(async () => {
      try {
        await save(toCreate(title, r, mode))
        onCreated()
      } catch (err) {
        // An advanced field whose migration hasn't run fails the whole
        // insert — say which, instead of leaving a dead button.
        setCreateError(err instanceof Error ? err.message : 'Could not create')
      }
    })
  }

  // ── Layout ─────────────────────────────────────────────────────────────────

  const notes: ReactNode = (
    <>
      {removed && (
        <Note>
          Removed <Frag>{removed.fragment}</Frag> from the text. It’s set under All fields now.{' '}
          <LinkButton onClick={undoRemoval}>Undo</LinkButton>
        </Note>
      )}
      {guessing === 'loading' && (
        <Note>
          <span aria-hidden="true" className="inline-block w-[11px] h-[11px] mr-1.5 -mb-px rounded-full border-[1.5px]
                     border-slate-200 dark:border-slate-700 border-t-accent-600 motion-safe:animate-spin" />
          Asking Claude about anything the text leaves blank. Enter still adds straight away.
        </Note>
      )}
      {guessing === 'error' && (
        <Note>
          Couldn’t reach Claude, so nothing was guessed. What you typed hasn’t changed.{' '}
          <LinkButton onClick={guessRest}>Try again</LinkButton>
        </Note>
      )}
      {createError && <Note tone="warn">{createError}</Note>}
    </>
  )

  const fieldProps = { r, set, clear, keep, dropGuess }
  const body = detailed
    ? (mode === 'task' ? <TaskFields {...fieldProps} projects={projects} /> : <HabitFields {...fieldProps} />)
    : mode === 'habit' ? <Essentials r={r} set={set} /> : null

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4"
      style={keyboard ? { paddingBottom: keyboard } : undefined}
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-slate-950/40 dark:bg-slate-950/60" />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'habit' ? 'Add habit' : 'Add task'}
        className={`relative w-full ${detailed ? 'sm:max-w-[680px]' : 'sm:max-w-[560px]'}
                    ${detailed && narrow && !keyboard ? 'h-[calc(100dvh-40px)]' : 'max-h-[88dvh]'}
                    bg-white dark:bg-slate-900 rounded-t-[20px] sm:rounded-2xl shadow-2xl
                    flex flex-col overflow-hidden`}
        style={keyboard ? { maxHeight: `calc(100dvh - ${keyboard + 12}px)` } : undefined}
        onClick={e => e.stopPropagation()}
      >
        <div aria-hidden="true" className="sm:hidden mx-auto mt-2 h-1 w-9 rounded-full bg-slate-200 dark:bg-slate-700 shrink-0" />

        <header className="flex items-center justify-between gap-3 pl-4 pr-3 sm:px-5 pt-2.5 sm:pt-4 pb-3 shrink-0">
          <div role="group" aria-label="What you’re adding" className="inline-flex gap-0.5 p-0.5 rounded-[10px] bg-slate-100 dark:bg-slate-800">
            {(['task', 'habit'] as const).map(m => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                onClick={() => switchMode(m)}
                className={`h-8 px-3.5 rounded-lg text-[13px] font-medium transition-colors ${
                  mode === m
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm ring-1 ring-slate-200 dark:ring-slate-700'
                    : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
              >
                {m === 'habit' ? '↻ Habit' : '✓ Task'}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            title="Close (Esc)"
            className="w-[34px] h-[34px] grid place-items-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200"
          >
            <X size={16} aria-hidden />
          </button>
        </header>

        <div className="flex flex-col gap-2.5 px-4 sm:px-5 pb-4 shrink-0">
          <QuickAddInput
            inputRef={inputRef}
            aria-label={mode === 'habit' ? 'Habit' : 'Task'}
            value={draft.text}
            onChange={type}
            onSubmit={add}
            tokens={parse.tokens}
            misses={parse.misses}
            placeholder={mode === 'habit' ? 'Add a habit, e.g. Gym 3x a week for 60m' : 'Add a task, e.g. Email Rosner tomorrow 5pm p1'}
          />
          <Receipt
            mode={mode}
            text={draft.text}
            title={title}
            chips={chips}
            onChip={onChip}
            misses={parse.misses}
            onFix={fixMiss}
            plan={mode === 'habit' && draft.text.trim() ? habitPlan(r) : null}
            notes={notes}
            tz={tz}
            projectName={projects[0]?.name}
            narrow={narrow}
          />
        </div>

        {body && (
          <div className="flex-1 min-h-0 overflow-y-auto border-t border-slate-100 dark:border-slate-800">
            {body}
          </div>
        )}

        <footer className="flex items-center gap-2 pl-2 sm:pl-3 pr-3 sm:pr-4 pt-2.5 pb-[max(12px,env(safe-area-inset-bottom))] border-t border-slate-100 dark:border-slate-800 shrink-0">
          <button
            type="button"
            onClick={() => chooseView(!detailed)}
            aria-expanded={detailed}
            className="h-[34px] px-2.5 rounded-lg text-[13px] font-medium text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-slate-200 inline-flex items-center gap-1.5"
          >
            {detailed ? 'Fewer fields' : 'All fields'}
            <ChevronDown size={13} aria-hidden className={`transition-transform ${detailed ? 'rotate-180' : ''}`} />
          </button>
          <span className="flex-1" />
          <button
            type="button"
            onClick={guessRest}
            disabled={!title || guessing === 'loading'}
            aria-label="Guess the rest with Claude"
            title="Claude fills in what the text doesn’t say, mostly energy. Nothing you typed changes."
            className="h-9 w-9 sm:w-auto sm:px-3 rounded-[10px] border border-slate-200 dark:border-slate-700 text-[13px] font-medium
                       text-slate-600 dark:text-slate-300 hover:border-slate-400 dark:hover:border-slate-500 inline-flex items-center justify-center gap-1.5
                       disabled:opacity-40"
          >
            <AiIcon size={13} className="text-accent-600 dark:text-accent-400" />
            <span className="hidden sm:inline">Guess the rest</span>
          </button>
          <button
            type="button"
            onClick={add}
            disabled={!title.trim() || isPending}
            className="h-9 pl-4 pr-2.5 rounded-[10px] bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-[13.5px] font-semibold
                       inline-flex items-center gap-2.5 hover:opacity-85 disabled:opacity-40 transition-opacity"
          >
            {isPending ? 'Adding…' : narrow ? 'Add' : mode === 'habit' ? 'Add habit' : 'Add task'}
            <kbd aria-hidden="true" className="font-mono text-[11px] leading-none px-1.5 py-1 rounded-[5px] bg-white/15 dark:bg-slate-900/10">↵</kbd>
          </button>
        </footer>
      </div>
    </div>
  )
}

// ── All fields ───────────────────────────────────────────────────────────────

interface FieldProps {
  r: Resolution
  set: <K extends Key>(k: K, v: Values[K]) => void
  clear: (k: Key) => void
  keep: (fragment: string) => void
  dropGuess: (k: Key) => void
}
type Own = Omit<FieldProps, 'set'>

function TaskFields({ projects, ...p }: FieldProps & { projects: Project[] }) {
  const { r, set } = p
  const rep = r.repeat.value
  const preset = PRESETS.some(x => x.rrule === rep?.rrule)
  const curve = CURVE.find(c => c.v === r.curve.value) ?? CURVE[0]
  return (
    <>
      <Group title="When" first>
        <Row k="due" label="Due" own={p} hint="fri · 3/14" htmlFor="f-due">
          <input id="f-due" type="date" className={INPUT} value={r.due.value ?? ''}
                 onChange={e => set('due', e.target.value || null)} />
        </Row>
        <Row k="time" label="Time" own={p} hint="5pm" htmlFor="f-time"
             help={r.due.value ? undefined : 'Needs a due date.'}>
          <input id="f-time" type="time" className={INPUT} disabled={!r.due.value}
                 value={r.time.value == null ? '' : hhmm(r.time.value)}
                 onChange={e => set('time', e.target.value ? minutes(e.target.value) : null)} />
        </Row>
        <Row k="repeat" label="Repeat" own={p} hint="every mon" htmlFor="f-repeat">
          <select id="f-repeat" className={`${INPUT} w-full`} value={rep?.rrule ?? ''}
                  onChange={e => set('repeat', e.target.value ? { rrule: e.target.value, fromCompletion: !!rep?.fromCompletion } : null)}>
            {PRESETS.map(x => <option key={x.id} value={x.rrule ?? ''}>{x.label}</option>)}
            {rep && !preset && <option value={rep.rrule}>{rruleToLabel(rep.rrule).replace(/^./, c => c.toUpperCase())}</option>}
          </select>
          <Check id="f-bang" checked={!!rep?.fromCompletion} disabled={!rep}
                 onChange={v => rep && set('repeat', { ...rep, fromCompletion: v })}>
            Count the next one from when I finish
          </Check>
        </Row>
        <Row k="notBefore" label="Not before" own={p} htmlFor="f-notBefore"
             help="Not scheduled before this, however much free time there is.">
          <input id="f-notBefore" type="date" className={INPUT} value={r.notBefore.value ?? ''}
                 onChange={e => set('notBefore', e.target.value || null)} />
        </Row>
        <Row k="curve" label="Urgency" own={p} group help={curve.help}>
          <Options fill value={r.curve.value} onPick={v => set('curve', v)}
                   options={CURVE.map(c => ({ v: c.v, label: c.label, icon: <Curve path={c.path} /> }))} />
        </Row>
      </Group>

      <Group title="Work">
        <Row k="project" label="Project" own={p} hint="#name" htmlFor="f-project">
          <ProjectPicker projects={projects} value={r.project.value ?? ''} onChange={id => set('project', id || null)} />
        </Row>
        <Row k="priority" label="Priority" own={p} group hint="p1–p4">
          <PriorityOptions value={r.priority.value} onPick={v => set('priority', v)} />
        </Row>
        <Row k="estimate" label="Estimate" own={p} hint="for 45m" htmlFor="f-estimate">
          <Minutes id="f-estimate" value={r.estimate.value} onSet={v => set('estimate', v)} quick={[15, 30, 60, 90]} />
        </Row>
        <Row k="energy" label="Energy" own={p} group>
          <EnergyOptions value={r.energy.value} onPick={v => set('energy', v)} />
        </Row>
      </Group>

      <Placement {...p} />
      <NotesGroup r={r} set={set} placeholder="Anything you’ll want in front of you when you sit down to it" />
    </>
  )
}

function HabitFields(p: FieldProps) {
  const { r, set } = p
  const on = daysOf(r.repeat.value)
  return (
    <>
      <Group title="How often" first>
        <Row k="target" label="Per week" own={p} group hint="3x a week">
          <Options fill value={r.target.value} onPick={v => set('target', v)}
                   options={[1, 2, 3, 4, 5, 6, 7].map(n => ({ v: n, label: `${n}×`, aria: `${n} times a week` }))} />
        </Row>
        <Row k="repeat" label="Days" own={p} group hint="every mon">
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAY_ORDER.map(d => (
              <button key={d} type="button" aria-pressed={on.includes(d)} aria-label={DAY_NAME[d]}
                      onClick={() => set('repeat', repeatFromDays(on.includes(d) ? on.filter(x => x !== d) : [...on, d]))}
                      className={`${OPT} w-[38px] !px-0 ${on.includes(d) ? OPT_ON : OPT_OFF}`}>
                {DAY_LETTER[d]}
              </button>
            ))}
          </div>
          <p className="text-[12.5px] text-slate-500 dark:text-slate-400">
            {on.length ? daysLabel(on).replace(/^./, c => c.toUpperCase()) : 'Any day'}
          </p>
        </Row>
        <Row k="estimate" label="Session" own={p} hint="for 45m" htmlFor="f-session">
          <Minutes id="f-session" value={r.estimate.value} onSet={v => set('estimate', v)} quick={[30, 45, 60, 90]} />
        </Row>
      </Group>

      <Group title="Work">
        <Row k="priority" label="Priority" own={p} group hint="p1–p4"
             help="Habits have no deadline, so this decides which one gets the good slot when the week is tight.">
          <PriorityOptions value={r.priority.value} onPick={v => set('priority', v)} />
        </Row>
        <Row k="energy" label="Energy" own={p} group>
          <EnergyOptions value={r.energy.value} onPick={v => set('energy', v)} />
        </Row>
        <Row k="avoidMeals" label="Meals" own={p} htmlFor="f-meals">
          <Check id="f-meals" checked={r.avoidMeals.value} onChange={v => set('avoidMeals', v)}>
            Not for an hour after a meal. For anything strenuous, like a gym session or a run.
          </Check>
        </Row>
      </Group>

      <Placement {...p} />
      <NotesGroup r={r} set={set} placeholder="Routine, gear, anything worth remembering" />
      <p className="px-4 sm:px-5 pb-4 text-xs leading-normal text-slate-400">
        Habits that shouldn’t share a day, like gym and running, are paired on
        the <a href="/habits" className="underline hover:text-accent-600">Habits page</a>.
      </p>
    </>
  )
}

/** A habit's two essentials, offered as quick picks in compact until they're set. */
function Essentials({ r, set }: { r: Resolution; set: FieldProps['set'] }) {
  const needTarget = r.target.value == null, needSession = r.estimate.value == null
  if (!needTarget && !needSession) return null
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-3 px-4 sm:px-5 py-3.5">
      {needTarget && (
        <div role="group" aria-labelledby="ess-target" className="flex flex-col gap-1.5">
          <span id="ess-target" className="text-xs font-medium text-slate-500">Per week</span>
          <Options value={null as number | null} onPick={v => set('target', v)}
                   options={[2, 3, 4, 5].map(n => ({ v: n, label: `${n}×`, aria: `${n} times a week` }))} />
        </div>
      )}
      {needSession && (
        <div role="group" aria-labelledby="ess-session" className="flex flex-col gap-1.5">
          <span id="ess-session" className="text-xs font-medium text-slate-500">Session</span>
          <Options value={null as number | null} onPick={v => set('estimate', v)}
                   options={[30, 45, 60, 90].map(n => ({ v: n, label: `${n}m`, aria: `${n} minutes` }))} />
        </div>
      )}
    </div>
  )
}

function Placement(p: FieldProps) {
  const { r, set } = p
  return (
    <Group title="Scheduling">
      <Row k="where" label="Where" own={p} group>
        <Options fill value={r.where.value} onPick={v => set('where', v)} options={WHERE} />
      </Row>
      <Row k="span" label="Ties me up" own={p} htmlFor="f-span"
           help="For things like laundry: only the estimate is booked, but you stay put for the whole time.">
        <div className="flex items-center gap-2">
          <NumberInput id="f-span" value={r.span.value} onSet={v => set('span', v)} placeholder="—" />
          <span className="text-[12.5px] text-slate-500">min in total</span>
        </div>
      </Row>
      <Row k="buffer" label="Buffer" own={p} group help="Transition time kept clear around it. None suits quick chores.">
        <Options fill value={r.buffer.value} onPick={v => set('buffer', v)} options={BUFFER} />
      </Row>
    </Group>
  )
}

function NotesGroup({ r, set, placeholder }: { r: Resolution; set: FieldProps['set']; placeholder: string }) {
  return (
    <Group title="Notes">
      <label htmlFor="f-notes" className="sr-only">Notes</label>
      <textarea id="f-notes" rows={2} value={r.notes.value} placeholder={placeholder}
                onChange={e => set('notes', e.target.value)}
                className={`${INPUT} w-full h-auto min-h-16 py-2 leading-snug resize-y mt-1.5 mb-1`} />
    </Group>
  )
}

// ── Pieces ───────────────────────────────────────────────────────────────────

const INPUT = 'h-[34px] px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-accent-500 disabled:opacity-45 min-w-0'
const OPT = 'min-h-[34px] px-2 sm:px-2.5 rounded-lg border text-[12.5px] sm:text-[13px] font-medium inline-flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors'
const OPT_ON = 'bg-slate-900 border-slate-900 text-white dark:bg-white dark:border-white dark:text-slate-900'
const OPT_OFF = 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-slate-400 dark:hover:border-slate-500'

function Group({ title, first, children }: { title: string; first?: boolean; children: ReactNode }) {
  return (
    <section className={`px-4 sm:px-5 pb-2.5 pt-1 ${first ? '' : 'border-t border-slate-100 dark:border-slate-800'}`}>
      <h3 className="text-[10.5px] font-semibold tracking-[0.12em] uppercase text-slate-400 mt-3.5 mb-1">{title}</h3>
      {children}
    </section>
  )
}

/**
 * One attribute: label, control, and who set it.
 *
 * Three columns from `sm` up. On a phone the owner sits beside the label and
 * the control takes the full width underneath. A row whose value was typed
 * rings its active control in that fragment's colour, the one link back to the
 * text that has to survive being out of sight of it.
 */
function Row({ k, label, own, hint, help, group, htmlFor, children }: {
  k: Key; label: string; own: Own; hint?: string; help?: string; group?: boolean; htmlFor?: string; children: ReactNode
}) {
  const x = own.r[k] as Resolved
  const typed = x.owner === 'typed' && x.token
  const labelId = `lbl-${k}`
  return (
    <div className={`grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[96px_minmax(0,1fr)_132px] gap-x-3.5 gap-y-1.5 py-2 items-start
                     ${typed ? `qa-${GROUP[x.token!.type]} [&_[aria-pressed=true]]:ring-[1.5px] [&_[aria-pressed=true]]:ring-[var(--qa-r)] [&_input:not([type=checkbox])]:ring-[1.5px] [&_input:not([type=checkbox])]:ring-[var(--qa-r)] [&_select]:ring-[1.5px] [&_select]:ring-[var(--qa-r)]` : ''}`}>
      <div className="col-start-1 row-start-1 self-center sm:self-start sm:pt-2 text-[13px] font-medium text-slate-500 dark:text-slate-400">
        {group ? <span id={labelId}>{label}</span> : <label htmlFor={htmlFor}>{label}</label>}
      </div>
      <div className="col-span-2 row-start-2 sm:col-span-1 sm:col-start-2 sm:row-start-1 flex flex-col gap-1.5 min-w-0"
           {...(group ? { role: 'group', 'aria-labelledby': labelId } : {})}>
        {children}
        {help && <p className="text-xs leading-snug text-slate-400">{help}</p>}
      </div>
      <div className="col-start-2 row-start-1 sm:col-start-3 flex items-center justify-end gap-0.5 min-h-6 sm:min-h-[34px] text-xs min-w-0">
        <OwnerCell k={k} x={x} hint={hint} own={own} />
      </div>
    </div>
  )
}

function OwnerCell({ k, x, hint, own }: { k: Key; x: Resolved; hint?: string; own: Own }) {
  if (x.owner === 'typed' && x.token) {
    const frag = x.token.text
    return (
      <>
        <span className={`qa-${GROUP[x.token.type]} inline-flex items-center gap-1.5 min-w-0 text-slate-700 dark:text-slate-300`} title="Set by what you typed">
          <i aria-hidden="true" className="w-[7px] h-[7px] rounded-[2px] bg-[var(--qa-r)] shrink-0" />
          <span className="font-mono text-[11.5px] truncate">“{frag}”</span>
        </span>
        <XButton label={`Keep “${frag}” as words`} onClick={() => own.keep(frag)} />
      </>
    )
  }
  if (x.owner === 'implied' && x.token) {
    return <span className="font-mono text-[11.5px] text-slate-400 truncate">from “{x.token.text}”</span>
  }
  if (x.owner === 'guessed') {
    return (
      <>
        <span className="inline-flex items-center gap-1 text-slate-600 dark:text-slate-300">
          <AiIcon size={12} className="text-accent-600 dark:text-accent-400" />guessed
        </span>
        <XButton label="Drop this guess" onClick={() => own.dropGuess(k)} />
      </>
    )
  }
  if (x.owner === 'set' && !isDefault(k, x.value)) {
    return (
      <button type="button" onClick={() => own.clear(k)}
              className="px-2 py-1.5 rounded-md font-medium text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-slate-200">
        Reset
      </button>
    )
  }
  return hint
    ? <code className="font-mono text-[11.5px] text-slate-400 text-right" title="You can type this instead">{hint}</code>
    : null
}

function XButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label}
            className="relative w-6 h-6 grid place-items-center rounded-md text-slate-400 text-[15px] leading-none
                       hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200
                       before:absolute before:-inset-[5px] before:content-['']">
      ×
    </button>
  )
}

function Options<T>({ value, onPick, options, fill }: {
  value: T
  onPick: (v: T) => void
  options: { v: T; label: string; aria?: string; icon?: ReactNode; sub?: string }[]
  fill?: boolean
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(o => {
        const on = o.v === value
        return (
          <button key={String(o.v)} type="button" aria-pressed={on} aria-label={o.aria} onClick={() => onPick(o.v)}
                  className={`${OPT} ${fill ? 'flex-1 basis-0' : ''} ${on ? OPT_ON : OPT_OFF}`}>
            {o.icon}<span>{o.label}</span>
            {o.sub && <span className="font-mono text-[11px] opacity-60">{o.sub}</span>}
          </button>
        )
      })}
    </div>
  )
}

/** Names, with the token beside each, so the button that lights up for `p1` says p1. */
function PriorityOptions({ value, onPick }: { value: 1 | 2 | 3 | 4; onPick: (v: 1 | 2 | 3 | 4) => void }) {
  return <Options fill value={value} onPick={onPick} options={PRIORITY.map(p => ({ v: p.v, label: p.label, sub: p.token }))} />
}

function EnergyOptions({ value, onPick }: { value: EnergyLevel; onPick: (v: EnergyLevel) => void }) {
  return (
    <Options fill value={value} onPick={onPick}
             options={ENERGY.map(e => ({ v: e, label: e[0].toUpperCase() + e.slice(1), icon: <EnergyIcon level={e} size={12} /> }))} />
  )
}

function Minutes({ id, value, onSet, quick }: { id: string; value: number | null; onSet: (v: number | null) => void; quick: number[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <NumberInput id={id} value={value} onSet={onSet} placeholder="min" />
      {quick.map(n => (
        <button key={n} type="button" aria-pressed={value === n} aria-label={`${n} minutes`} onClick={() => onSet(n)}
                className={`${OPT} ${value === n ? OPT_ON : OPT_OFF}`}>
          {n}
        </button>
      ))}
    </div>
  )
}

function NumberInput({ id, value, onSet, placeholder }: { id: string; value: number | null; onSet: (v: number | null) => void; placeholder: string }) {
  return (
    <input id={id} type="number" inputMode="numeric" min={1} placeholder={placeholder}
           value={value ?? ''} onChange={e => { const n = parseInt(e.target.value, 10); onSet(n > 0 ? n : null) }}
           className={`${INPUT} w-[78px] font-mono text-[13.5px]`} />
  )
}

function Check({ id, checked, disabled, onChange, children }: {
  id: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void; children: ReactNode
}) {
  return (
    <label htmlFor={id} className={`flex items-start gap-2.5 text-[13px] leading-snug text-slate-600 dark:text-slate-300 ${disabled ? 'opacity-45' : 'cursor-pointer'}`}>
      <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)}
             className="mt-0.5 w-4 h-4 shrink-0 accent-slate-900 dark:accent-white" />
      {children}
    </label>
  )
}

function Curve({ path }: { path: string }) {
  return (
    <svg width="26" height="14" viewBox="0 0 26 14" aria-hidden="true" className="shrink-0">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function Note({ children, tone }: { children: ReactNode; tone?: 'warn' }) {
  return <p className={`text-[12.5px] leading-normal ${tone === 'warn' ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500 dark:text-slate-400'}`}>{children}</p>
}

function Frag({ children }: { children: ReactNode }) {
  return <span className="font-mono text-xs text-slate-700 dark:text-slate-300">{children}</span>
}

function LinkButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="font-medium text-accent-700 dark:text-accent-400 underline underline-offset-2">
      {children}
    </button>
  )
}

function hhmm(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}
function minutes(v: string): number {
  return Number(v.slice(0, 2)) * 60 + Number(v.slice(3, 5))
}

// ── The phone ────────────────────────────────────────────────────────────────

/** Below the tab bar's breakpoint the modal is a sheet and the receipt one scrolling row. */
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)')
    const update = () => setNarrow(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])
  return narrow
}

/**
 * How much of the layout viewport the on-screen keyboard covers, so the sheet
 * can sit on top of it. iOS Safari shrinks only the visual viewport when the
 * keyboard opens, so a sheet pinned to the bottom would otherwise end up under
 * the keyboard.
 */
function useKeyboardInset(): number {
  const [inset, setInset] = useState(0)
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const update = () => setInset(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)))
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])
  return inset
}
