/**
 * A task as the shared row draws it.
 *
 * Lifted out of `TaskList` when the project table became a second caller.
 * Every screen that draws a task row has to agree on what the chip says and
 * when a task is late — two copies of this is two places for them to drift,
 * and the chip rule in particular is a judgement ("what the header does not
 * already say") that would not survive being re-derived.
 */

import type { Task, Project } from '@/types'
import { formatTimeOfDay } from '@/lib/task-format'
import type { TaskRowModel } from '@/components/ds/TaskRow'

type RowSource = Pick<Task,
  'id' | 'title' | 'due_date' | 'estimated_minutes' | 'adjusted_minutes' |
  'urgency_score' | 'scheduled_start' | 'rrule'> & { project?: Project | null }

/**
 * `kidCount` is the number of subtasks; the caller counts them, because only
 * it knows whether it fetched them.
 *
 * The chip carries only what the group header does not. A "TODAY" badge on
 * every row inside a group headed Today is the noise this replaces; what earns
 * a chip is the thing the header cannot say — that this one already has a
 * slot, or repeats, or is a run of steps.
 */
export function toTaskRowModel(
  task: RowSource,
  opts: { kidCount?: number; todayStr: string; done?: boolean },
): TaskRowModel {
  const { kidCount = 0, todayStr, done } = opts

  const late = task.due_date && task.due_date.slice(0, 10) < todayStr
    ? Math.round(
        (Date.parse(todayStr + 'T00:00:00Z') - Date.parse(task.due_date.slice(0, 10) + 'T00:00:00Z'))
        / 86_400_000)
    : 0

  const chip =
    task.scheduled_start
      ? `scheduled ${formatTimeOfDay(
          new Date(task.scheduled_start).getHours() * 60 + new Date(task.scheduled_start).getMinutes(),
        ).toLowerCase()}`
      : kidCount > 0 ? `${kidCount} steps`
      : task.rrule ? 'repeats'
      : null

  return {
    id: task.id,
    title: task.title,
    color: task.project?.color ?? null,
    project: task.project?.name ?? 'Inbox',
    minutes: task.adjusted_minutes ?? task.estimated_minutes,
    urgency: task.urgency_score,
    chip,
    lateLabel: late > 0 ? `${late} day${late === 1 ? '' : 's'} late` : null,
    done,
  }
}
