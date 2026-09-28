'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { AiIcon } from '@/components/icons'
import { parseQuickAdd, type QuickAddMiss } from '@/lib/quick-add'
import { GROUP, type Mode, type ReceiptChip } from '@/lib/add-task-model'

/**
 * What the field will create, in words, directly under it.
 *
 * The highlight says "this was understood"; the receipt says what it was
 * understood *as* — the part that can be wrong ("3/4" is two different days
 * either side of an ocean) — and lists what was set elsewhere or guessed, so
 * nothing is in effect that you can't see. Every entry undoes where it sits.
 */
interface Props {
  mode: Mode
  text: string
  title: string
  chips: ReceiptChip[]
  onChip?: (chip: ReceiptChip) => void
  misses?: QuickAddMiss[]
  /** Replace a mistyped `#name` with the one it probably meant. */
  onFix?: (miss: QuickAddMiss, fixed: string) => void
  /** A habit's plan in one sentence. */
  plan?: string | null
  /** Anything the caller needs to say: an undo, the guess's progress, an error. */
  notes?: ReactNode
  /** For the legend: the zone to read it in and a real project name to show. */
  tz: string
  projectName?: string
  /** One row that scrolls sideways, for a phone. */
  narrow?: boolean
}

export default function Receipt({
  mode, text, title, chips, onChip, misses = [], onFix, plan, notes, tz, projectName, narrow,
}: Props) {
  const empty = !text.trim()
  const spoken = useSettled(
    empty ? '' : [title || 'No title yet', ...chips.map(c => c.label)].join('. '),
    700,
  )

  return (
    <div className="flex flex-col gap-2.5 min-w-0 px-0.5">
      {/* Spoken once typing settles, rather than on every keystroke. */}
      <p className="sr-only" aria-live="polite">{spoken}</p>

      {empty
        ? <Legend mode={mode} tz={tz} projectName={projectName} />
        : title
          ? <p className="flex items-baseline gap-2 text-sm leading-snug text-slate-900 dark:text-slate-100 min-w-0">
              <span aria-hidden="true" className="font-mono text-slate-400 shrink-0">↳</span>
              <span className="font-medium [overflow-wrap:anywhere]">{title}</span>
            </p>
          : <p className="text-sm text-slate-500 dark:text-slate-400">
              No {mode === 'habit' ? 'name' : 'title'} yet. Every word so far is a setting.
            </p>}

      {chips.length > 0 && (
        <div className={narrow
          ? 'flex gap-1.5 overflow-x-auto -mx-4 px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
          : 'flex flex-wrap gap-1.5'}>
          {chips.map((c, i) => <Chip key={`${c.kind}-${c.fragment ?? c.key}-${i}`} chip={c} onClick={onChip} />)}
        </div>
      )}

      {plan && <p className="text-[12.5px] leading-normal text-slate-500 dark:text-slate-400">{plan}</p>}

      {misses.map(m => <MissNote key={m.start} miss={m} onFix={onFix} />)}

      {notes}
    </div>
  )
}

function Chip({ chip, onClick }: { chip: ReceiptChip; onClick?: (c: ReceiptChip) => void }) {
  const base = 'inline-flex items-center gap-1.5 h-7 pl-2.5 pr-0.5 rounded-[7px] border text-[12.5px] font-medium whitespace-nowrap shrink-0'
  const tone =
    chip.kind === 'guessed' ? 'border-dashed border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300'
    : chip.kind === 'kept'  ? 'border-dashed border-slate-200 dark:border-slate-700 text-slate-400 font-normal'
    : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
  return (
    <span className={`${base} ${tone} ${chip.group ? `qa-${chip.group}` : ''}`}>
      {chip.kind === 'typed' && <i aria-hidden="true" className="w-[7px] h-[7px] rounded-[2px] bg-[var(--qa-r)] shrink-0" />}
      {chip.kind === 'guessed' && <AiIcon size={12} className="text-accent-600 dark:text-accent-400 shrink-0" />}
      <span>{chip.label}</span>
      <button
        type="button"
        onClick={() => onClick?.(chip)}
        aria-label={chip.undo}
        title={chip.undo}
        disabled={!onClick}
        className="relative w-[22px] h-[22px] grid place-items-center rounded-[5px] text-slate-400
                   hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-700 dark:hover:text-slate-200
                   before:absolute before:-inset-1.5 before:content-['']"
      >
        {chip.kind === 'kept' ? '↺' : '×'}
      </button>
    </span>
  )
}

function MissNote({ miss, onFix }: { miss: QuickAddMiss; onFix?: (m: QuickAddMiss, fixed: string) => void }) {
  const near = miss.reason === 'no-project' ? miss.candidates[0] : undefined
  const fixed = near ? (/\s/.test(near.name) ? `#{${near.name}}` : `#${near.name.toLowerCase()}`) : null
  return (
    <p className="text-[12.5px] leading-normal text-slate-500 dark:text-slate-400">
      <span className="font-mono text-xs text-slate-700 dark:text-slate-300">{miss.text}</span>{' '}
      {miss.reason === 'ambiguous-project'
        ? <>matches {miss.candidates.map(c => c.name).join(' and ')}. Type more of the name.</>
        : <>isn’t one of your projects, so it stays in the title.</>}
      {fixed && onFix && (
        <> <button
          type="button"
          onClick={() => onFix(miss, fixed)}
          className="font-medium text-accent-700 dark:text-accent-400 underline underline-offset-2"
        >
          Use {fixed}
        </button></>
      )}
    </p>
  )
}

/**
 * What an empty field shows: a line of syntax, highlighted by the real parser
 * as it renders. If the grammar ever stops reading one of these, it visibly
 * loses its mark — so this cannot teach syntax that doesn't work, which the
 * old placeholder did.
 */
function Legend({ mode, tz, projectName }: { mode: Mode; tz: string; projectName?: string }) {
  const pieces = useMemo(() => {
    const tag = projectName ? (/\s/.test(projectName) ? `#{${projectName}}` : `#${projectName.toLowerCase()}`) : null
    const sample = mode === 'habit'
      ? '3x a week · every mon, wed · for 45m · p2'
      : ['tomorrow 5pm', tag, 'p1', 'every mon', 'for 45m'].filter(Boolean).join(' · ')
    const r = parseQuickAdd(sample, {
      tz, mode, projects: projectName ? [{ id: 'legend', name: projectName }] : [],
    })
    const out: { text: string; cls: string | null }[] = []
    let at = 0
    for (const t of r.tokens) {
      if (t.start > at) out.push({ text: sample.slice(at, t.start), cls: null })
      out.push({ text: t.text, cls: `qa-mark qa-${GROUP[t.type]}` })
      at = t.end
    }
    out.push({ text: sample.slice(at), cls: null })
    return out
  }, [mode, tz, projectName])

  return (
    <div className="flex flex-col gap-1.5 text-[13px] leading-normal text-slate-500 dark:text-slate-400">
      <span>Type it the way you’d say it. These light up when they’re understood:</span>
      <span className="text-[13.5px] leading-[1.9] text-slate-700 dark:text-slate-300">
        {pieces.map((p, i) => p.cls ? <span key={i} className={p.cls}>{p.text}</span> : <span key={i}>{p.text}</span>)}
      </span>
      <a href="/help/quick-add" target="_blank" rel="noopener noreferrer"
         className="self-start text-xs text-slate-400 hover:text-accent-600 dark:hover:text-accent-400">
        All the syntax ↗
      </a>
    </div>
  )
}

/** The value once it has stopped changing for `ms`. */
function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return settled
}
