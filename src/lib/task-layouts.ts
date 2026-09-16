/**
 * Task-row layouts.
 *
 * The task list can be drawn four ways. They are not skins: each one is a
 * separate row component with its own structure, and the choice is the user's,
 * stored per browser.
 *
 * ── Why four, and what it costs ──────────────────────────────────────────────
 *
 * Every feature that touches a row has to be built four times. The fold toggle,
 * the subtask count, the parent breadcrumb, the someday and recurring badges,
 * the priority circle — each exists once per layout. That cost is real and was
 * accepted deliberately: this is a single-user app and the owner wanted to keep
 * all four rather than commit to one.
 *
 * **If you add something to a row, add it to all four**, or note in the layout's
 * `omits` list why it doesn't apply. `TaskRowProps` in TaskRowLayouts.tsx is the
 * contract — anything a row can show arrives through it, so the compiler tells
 * you what you have to handle.
 *
 * ── What they share ──────────────────────────────────────────────────────────
 *
 * All four drop three things the old row had, on purpose:
 *   - the urgency score and curve glyph (`67`, `╱ ⌒ ⌐`) — an internal model
 *     leaking into the UI; it lives in the task detail panel instead
 *   - emoji as data encoding (🌿 ⚡ 🔥 ↻ 📦) — renders differently per platform
 *     and can't be styled
 *   - the filled project chip — a coloured dot carries the same information
 *     without competing with the deadline for attention
 *
 * Colour is reserved for one thing per row: how close the deadline is.
 */

export type TaskLayoutId = 'rail' | 'ledger' | 'airy' | 'editorial'

export interface TaskLayoutMeta {
  id: TaskLayoutId
  label: string
  /** One line, shown on the settings card. */
  blurb: string
  /** What the layout is for, shown under the card. */
  description: string
  /** Anything the layout deliberately doesn't render. */
  omits: string[]
  density: 'compact' | 'spacious'
}

export const TASK_LAYOUTS: TaskLayoutMeta[] = [
  {
    id: 'rail',
    label: 'Rail',
    density: 'compact',
    blurb: 'Tight rows, priority as a coloured edge',
    description:
      'One surface with hairline dividers and no box per task. Priority shows as a '
      + 'rail on the left edge, and only for high and critical — a list where every '
      + 'row is coloured has no emphasis left to spend. Metadata collapses to a '
      + 'single muted line under the title.',
    omits: [],
  },
  {
    id: 'ledger',
    label: 'Ledger',
    density: 'compact',
    blurb: 'Aligned columns with a header',
    description:
      'Project, estimate and deadline line up in fixed columns under a header row, '
      + 'so you scan down one attribute at a time instead of re-reading each task. '
      + 'The densest option and the best for answering "what is due soonest". '
      + 'Subtasks indent within the title column only, so the columns stay true.',
    omits: ['Energy — there is no column for it without crowding the title'],
  },
  {
    id: 'airy',
    label: 'Airy',
    density: 'spacious',
    blurb: 'Room to breathe, larger titles',
    description:
      'Generous vertical rhythm and a larger title, with metadata demoted to a '
      + 'quiet second line. Shows roughly half as many tasks per screen as Rail. '
      + 'Pairs well with grouping by project, which gives the extra space structure.',
    omits: [],
  },
  {
    id: 'editorial',
    label: 'Editorial',
    density: 'spacious',
    blurb: 'Strong type contrast, project in the margin',
    description:
      'The most distinctive of the four: large titles, the project as a small '
      + 'uppercase label, and a hairline of project colour in the left margin. '
      + 'The deadline sits top-right in small caps rather than inline. Fewest '
      + 'tasks per screen; best when the list is short.',
    omits: ['Energy — the metadata line is deliberately kept to three items'],
  },
]

export const DEFAULT_TASK_LAYOUT: TaskLayoutId = 'rail'

const LAYOUT_KEY = 'planner-task-layout'

export function isTaskLayoutId(v: unknown): v is TaskLayoutId {
  return TASK_LAYOUTS.some(l => l.id === v)
}

/**
 * Read the stored layout.
 *
 * localStorage, matching the default-view and theme preferences rather than the
 * scheduling config: it changes nothing the server computes, and a per-browser
 * choice is right for something this personal. Returns the default on the
 * server and in a private window, where the read throws.
 */
export function getStoredTaskLayout(): TaskLayoutId {
  if (typeof window === 'undefined') return DEFAULT_TASK_LAYOUT
  try {
    const v = window.localStorage.getItem(LAYOUT_KEY)
    return isTaskLayoutId(v) ? v : DEFAULT_TASK_LAYOUT
  } catch {
    return DEFAULT_TASK_LAYOUT
  }
}

export function storeTaskLayout(id: TaskLayoutId): void {
  try { window.localStorage.setItem(LAYOUT_KEY, id) } catch { /* private mode */ }
}
