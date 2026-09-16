'use client'

/**
 * The four task-row layouts. See src/lib/task-layouts.ts for what they are and
 * why there are four of them.
 *
 * Adding something to a row means adding it to all four. `TaskRowProps` is the
 * contract: everything a row can show arrives through it, so the compiler will
 * point at each layout that hasn't handled a new field.
 */

import React from 'react'
import { Task, Project, HabitStreak, INBOX_PROJECT } from '@/types'
import { formatMinutes, formatDue, dueToneClass } from '@/lib/task-format'
import type { TaskLayoutId } from '@/lib/task-layouts'

export type LayoutTask = Task & {
  project: Project
  parent?: { id: string; title: string } | null
}

export interface TaskRowProps {
  task: LayoutTask
  /** Rendered beneath its parent rather than loose in the list. */
  isChild: boolean
  /** Subtasks this row owns, 0 for a child or a childless task. */
  kidCount: number
  /** Its subtasks are currently hidden. */
  collapsed: boolean
  streak?: HabitStreak | null
  onToggleFold: () => void
  onOpen: () => void
  onDone: (e: React.MouseEvent) => void
}

/** A run of rows. Layouts that need a container or a header supply one. */
export interface TaskListShellProps { children: React.ReactNode }

// ── Shared pieces ────────────────────────────────────────────────────────────

const PRIORITY_HEX: Record<number, string> = {
  4: '#ef4444',   // critical
  3: '#f97316',   // high
  2: '#3b82f6',   // medium
  1: '#cbd5e1',   // low
}
const ENERGY_LABEL: Record<string, string> = { low: 'Low', medium: 'Med', high: 'High' }

/** The complete button. Neutral by default; colour is the deadline's job. */
function DoneCircle({ task, size, tinted, onDone }: {
  task: LayoutTask; size: number; tinted: boolean; onDone: (e: React.MouseEvent) => void
}) {
  return (
    <button
      onClick={onDone}
      title="Mark done"
      aria-label={`Mark ${task.title} done`}
      className="shrink-0 rounded-full border-2 block transition-colors hover:border-accent-500"
      style={{
        width: size, height: size,
        borderColor: tinted ? PRIORITY_HEX[task.priority] : undefined,
      }}
      data-neutral={!tinted || undefined}
    />
  )
}

/** ▶ / ▼ on a parent, a bullet on a child, an aligned gap otherwise. */
function Fold({ isChild, kidCount, collapsed, onToggleFold, className = '' }: {
  isChild: boolean; kidCount: number; collapsed: boolean; onToggleFold: () => void; className?: string
}) {
  if (isChild) {
    return <span className={`text-slate-300 dark:text-slate-600 text-xs shrink-0 select-none ${className}`}>•</span>
  }
  if (kidCount > 0) {
    return (
      <button
        onClick={e => { e.stopPropagation(); onToggleFold() }}
        title={collapsed ? `Show ${kidCount} subtask${kidCount !== 1 ? 's' : ''}` : 'Hide subtasks'}
        className={`w-3 shrink-0 text-[10px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors ${className}`}
      >
        {collapsed ? '▶' : '▼'}
      </button>
    )
  }
  return <span className={`w-3 shrink-0 ${className}`} />
}

/** someday / repeats, as words rather than emoji. */
function KindTag({ task, streak }: { task: LayoutTask; streak?: HabitStreak | null }) {
  if (task.type === 'someday') {
    return <span className="text-[10px] text-slate-400 shrink-0">someday</span>
  }
  if (task.type === 'recurring') {
    const n = streak?.current_streak ?? 0
    return (
      <span className="text-[10px] text-slate-400 shrink-0">
        repeats{n > 0 ? ` · ${n}` : ''}
      </span>
    )
  }
  return null
}

function ProjectDot({ task, dim = false }: { task: LayoutTask; dim?: boolean }) {
  const proj = task.project ?? INBOX_PROJECT
  return (
    <span
      className={`w-1.5 h-1.5 rounded-full shrink-0 ${dim ? 'opacity-70' : ''}`}
      style={{ background: proj.color }}
    />
  )
}

function projectName(task: LayoutTask) {
  return (task.project ?? INBOX_PROJECT).name
}

/** "↳ Parent" — only when a subtask sits loose in the list. */
function ParentCrumb({ task, isChild }: { task: LayoutTask; isChild: boolean }) {
  if (!task.parent || isChild) return null
  return (
    <span className="truncate max-w-[10rem]" title={`Subtask of ${task.parent.title}`}>
      ↳ {task.parent.title}
    </span>
  )
}

const estOf = (t: LayoutTask) => t.adjusted_minutes ?? t.estimated_minutes

// ══════════════════════════════════════════════════════════════════════════════
// RAIL — compact. One surface, hairline dividers, priority as a left edge.
// ══════════════════════════════════════════════════════════════════════════════

function RailShell({ children }: TaskListShellProps) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden divide-y divide-slate-100 dark:divide-slate-800">
      {children}
    </div>
  )
}

function RailRow(p: TaskRowProps) {
  const { task } = p
  const due = formatDue(task.due_date)
  const est = estOf(task)
  return (
    <div
      onClick={p.onOpen}
      className="group relative flex items-center gap-3 pr-3 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors cursor-pointer"
      style={{ paddingLeft: p.isChild ? 36 : 16 }}
    >
      {/* Priority, and only when it's worth saying. */}
      {task.priority >= 3 && (
        <span className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ background: PRIORITY_HEX[task.priority] }} />
      )}
      <Fold {...p} onToggleFold={p.onToggleFold} />
      <DoneCircle task={task} size={16} tinted={false} onDone={p.onDone} />

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-[13px] font-medium text-slate-800 dark:text-slate-100 truncate">{task.title}</span>
          <KindTag task={task} streak={p.streak} />
        </div>
        <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-slate-400">
          <ProjectDot task={task} dim />
          <span className="truncate">{projectName(task)}</span>
          <ParentCrumb task={task} isChild={p.isChild} />
          {p.kidCount > 0 && p.collapsed && <><span>·</span><span>{p.kidCount} steps</span></>}
          <span>·</span><span>{ENERGY_LABEL[task.energy_required]}</span>
        </div>
      </div>

      {est && <span className="text-[11px] text-slate-400 tabular-nums shrink-0">{formatMinutes(est)}</span>}
      {due && (
        <span className={`text-[11px] font-medium tabular-nums shrink-0 w-16 text-right ${dueToneClass(due.tone)}`}>
          {due.label}
        </span>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// LEDGER — compact. Fixed columns under a header, so attributes line up.
// ══════════════════════════════════════════════════════════════════════════════

const LEDGER_HEAD = 'text-[10px] font-semibold uppercase tracking-wider text-slate-400'

function LedgerShell({ children }: TaskListShellProps) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/30">
        <span className="w-[14px] shrink-0" />
        <span className={`${LEDGER_HEAD} flex-1`}>Task</span>
        <span className={`${LEDGER_HEAD} w-28 hidden sm:block`}>Project</span>
        <span className={`${LEDGER_HEAD} w-12 text-right`}>Est</span>
        <span className={`${LEDGER_HEAD} w-16 text-right`}>Due</span>
      </div>
      <div className="divide-y divide-slate-100 dark:divide-slate-800/60">{children}</div>
    </div>
  )
}

function LedgerRow(p: TaskRowProps) {
  const { task } = p
  const due = formatDue(task.due_date)
  const est = estOf(task)
  return (
    <div
      onClick={p.onOpen}
      className="flex items-center gap-3 px-4 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors cursor-pointer"
    >
      <DoneCircle task={task} size={14} tinted onDone={p.onDone} />

      {/* Only the title cell indents, so the columns stay true. */}
      <div className="flex-1 min-w-0 flex items-baseline gap-2" style={{ paddingLeft: p.isChild ? 20 : 0 }}>
        <Fold {...p} onToggleFold={p.onToggleFold} />
        <span className="text-[13px] text-slate-800 dark:text-slate-100 truncate">{task.title}</span>
        {p.kidCount > 0 && p.collapsed && (
          <span className="text-[10px] text-slate-400 shrink-0">+{p.kidCount}</span>
        )}
        <span className="text-[10px] text-slate-400 shrink-0 hidden sm:flex items-center gap-2">
          <KindTag task={task} streak={p.streak} />
          <ParentCrumb task={task} isChild={p.isChild} />
        </span>
      </div>

      <span className="w-28 shrink-0 hidden sm:flex items-center gap-1.5 min-w-0">
        <ProjectDot task={task} />
        <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{projectName(task)}</span>
      </span>
      <span className="w-12 shrink-0 text-right text-[11px] text-slate-400 tabular-nums font-mono">
        {est ? formatMinutes(est) : '—'}
      </span>
      <span className={`w-16 shrink-0 text-right text-[11px] tabular-nums font-medium ${
        due ? dueToneClass(due.tone) : 'text-slate-300 dark:text-slate-600'
      }`}>
        {due?.label ?? '—'}
      </span>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// AIRY — spacious. Larger titles, metadata demoted to a quiet second line.
// ══════════════════════════════════════════════════════════════════════════════

function AiryShell({ children }: TaskListShellProps) {
  // -mx-3 cancels the row's own padding so a standalone list still aligns with
  // the page. The bleed lives here, not on the row: Upcoming renders rows
  // without a shell inside a day card that clips overflow.
  return <div className="flex flex-col -mx-3">{children}</div>
}

function AiryRow(p: TaskRowProps) {
  const { task } = p
  const due = formatDue(task.due_date)
  const est = estOf(task)
  const sep = <span className="text-slate-300 dark:text-slate-700">·</span>
  return (
    <div
      onClick={p.onOpen}
      className="group flex items-start gap-3.5 py-3 px-3 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors cursor-pointer"
      style={{ marginLeft: p.isChild ? 24 : undefined }}
    >
      <span className="pt-1"><Fold {...p} onToggleFold={p.onToggleFold} /></span>
      <span className="pt-0.5"><DoneCircle task={task} size={17} tinted={false} onDone={p.onDone} /></span>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <p className="text-[15px] leading-snug text-slate-800 dark:text-slate-100 truncate">{task.title}</p>
          <KindTag task={task} streak={p.streak} />
        </div>
        <div className="flex items-center gap-2 mt-1 text-[12px] text-slate-400 flex-wrap">
          <span className="flex items-center gap-1.5"><ProjectDot task={task} />{projectName(task)}</span>
          {est && <>{sep}<span>{formatMinutes(est)}</span></>}
          <>{sep}<span>{ENERGY_LABEL[task.energy_required]}</span></>
          {p.kidCount > 0 && p.collapsed && <>{sep}<span>{p.kidCount} steps</span></>}
          {task.parent && !p.isChild && <>{sep}<ParentCrumb task={task} isChild={p.isChild} /></>}
        </div>
      </div>

      {due && (
        <span className={`text-[12px] shrink-0 pt-0.5 tabular-nums ${
          due.tone === 'now' ? 'text-slate-600 dark:text-slate-300 font-medium' : dueToneClass(due.tone)
        }`}>
          {due.label}
        </span>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// EDITORIAL — spacious. Type contrast, project in the margin, deadline in caps.
// ══════════════════════════════════════════════════════════════════════════════

function EditorialShell({ children }: TaskListShellProps) {
  // Same reasoning as AiryShell: the row carries its padding, the shell cancels
  // it so a standalone list sits flush with the page.
  return <div className="flex flex-col divide-y divide-slate-100 dark:divide-slate-800 -mx-4">{children}</div>
}

function EditorialRow(p: TaskRowProps) {
  const { task } = p
  const due = formatDue(task.due_date)
  const est = estOf(task)
  const dash = <span className="text-slate-300 dark:text-slate-700">—</span>
  return (
    <div
      onClick={p.onOpen}
      className="group flex items-start gap-5 py-5 px-4 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors cursor-pointer"
      style={{ marginLeft: p.isChild ? 28 : undefined }}
    >
      <div className="flex items-center gap-3 shrink-0 pt-1">
        <span className="w-[2px] h-6 rounded-full" style={{ background: (task.project ?? INBOX_PROJECT).color }} />
        <Fold {...p} onToggleFold={p.onToggleFold} />
        <DoneCircle task={task} size={18} tinted={false} onDone={p.onDone} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-4">
          <h4 className="text-[17px] font-medium leading-snug tracking-tight text-slate-900 dark:text-slate-50 truncate">
            {task.title}
          </h4>
          {due && (
            <span className={`text-[11px] uppercase tracking-wider shrink-0 ${
              due.tone === 'now' ? 'text-slate-700 dark:text-slate-200' : dueToneClass(due.tone)
            }`}>
              {due.label}
            </span>
          )}
        </div>
        <p className="mt-1.5 text-[12px] text-slate-400 flex items-center gap-2 flex-wrap">
          <span className="uppercase tracking-wide">{projectName(task)}</span>
          {est && <>{dash}<span>{formatMinutes(est)}</span></>}
          {p.kidCount > 0 && p.collapsed && <>{dash}<span>{p.kidCount} steps</span></>}
          {task.parent && !p.isChild && <>{dash}<ParentCrumb task={task} isChild={p.isChild} /></>}
          <KindTag task={task} streak={p.streak} />
        </p>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════

export interface TaskLayoutImpl {
  Shell: React.FC<TaskListShellProps>
  Row:   React.FC<TaskRowProps>
  /** Space between one run of rows and the next, when grouping is on. */
  groupGap: string
}

export const TASK_LAYOUT_IMPLS: Record<TaskLayoutId, TaskLayoutImpl> = {
  rail:      { Shell: RailShell,      Row: RailRow,      groupGap: 'gap-1.5' },
  ledger:    { Shell: LedgerShell,    Row: LedgerRow,    groupGap: 'gap-1.5' },
  airy:      { Shell: AiryShell,      Row: AiryRow,      groupGap: 'gap-2'   },
  editorial: { Shell: EditorialShell, Row: EditorialRow, groupGap: 'gap-4'   },
}
