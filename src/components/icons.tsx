import {
  Leaf, Zap, Flame, Repeat, Calendar, Target, Archive, Pencil, Settings,
  Clock, Sprout, Lock, Inbox, Sun, Moon, Monitor, TriangleAlert, CheckCircle2,
  PartyPopper, ThumbsUp, ThumbsDown, ChartColumn, CircleAlert, Sparkles,
  type LucideIcon,
} from 'lucide-react'
import type { EnergyLevel } from '@/types'

/**
 * Every icon the app draws, in one place.
 *
 * Emoji were doing this job, and doing it badly for anything ordinal: the five
 * energy faces are meant to read as a scale, and whether 😔 looks lower than 😐
 * depends on the platform's font. They also sat at whatever size the
 * surrounding text happened to be, so the same meaning was a different weight
 * in each of the six places `ENERGY_ICON` had been copied to.
 *
 * Importing lucide here rather than at each call site keeps the dependency at
 * one boundary — if it is ever replaced, this is the file that changes.
 */

/** 14px sits on a text-xs line the way the emoji did. */
export const ICON_SIZE = 14

export type { LucideIcon }

// ── Energy ───────────────────────────────────────────────────────────────────

/**
 * The three-level scale on a task: what it will cost you to start.
 *
 * Leaf → Zap → Flame keeps the reading the emoji had (🌿 ⚡ 🔥) rather than
 * inventing a new vocabulary for a value people already recognise.
 */
export const ENERGY_ICON: Record<EnergyLevel, LucideIcon> = {
  low:    Leaf,
  medium: Zap,
  high:   Flame,
}

export const ENERGY_LABEL: Record<EnergyLevel, string> = {
  low: 'Low', medium: 'Medium', high: 'High',
}

/** The icon for a task's energy, sized to sit inline with small text. */
export function EnergyIcon({ level, size = ICON_SIZE, className = '' }: {
  level: EnergyLevel
  size?: number
  className?: string
}) {
  const Icon = ENERGY_ICON[level]
  return <Icon size={size} className={`shrink-0 ${className}`} aria-hidden />
}

/**
 * The 1–5 self-report scale, as a ramp rather than five faces.
 *
 * There is no honest five-icon set for "how do you feel" — the emoji were five
 * unrelated pictures the reader had to rank from memory. One glyph at graded
 * opacity is ordinal by construction, and it is the encoding Analytics already
 * uses for the same values (`ENERGY_OPACITY`, `levelOpacity`).
 */
export const ENERGY_RAMP = [0.28, 0.45, 0.62, 0.8, 1] as const

export function EnergyLevelIcon({ level, size = 16, className = '' }: {
  level: 1 | 2 | 3 | 4 | 5
  size?: number
  className?: string
}) {
  return (
    <Zap
      size={size}
      className={`shrink-0 ${className}`}
      style={{ opacity: ENERGY_RAMP[level - 1] }}
      aria-hidden
    />
  )
}

// ── Everything else, named for what it means here ────────────────────────────
//
// Aliased rather than used directly so a call site says `<RecurringIcon />`
// and not `<Repeat />` — the name at the point of use should be the app's
// word for the thing, not the icon set's.

export {
  Repeat        as RecurringIcon,
  Calendar      as CalendarIcon,
  Target        as FocusIcon,
  Archive       as ArchiveIcon,
  Pencil        as EditIcon,
  Settings      as SettingsIcon,
  Clock         as TimeIcon,
  Sprout        as StreakIcon,
  Lock          as LockedIcon,
  Inbox         as InboxIcon,
  Sun           as LightIcon,
  Moon          as DarkIcon,
  Monitor       as SystemIcon,
  TriangleAlert as WarningIcon,
  CheckCircle2  as DoneIcon,
  PartyPopper   as CelebrateIcon,
  ThumbsUp      as AccurateIcon,
  ThumbsDown    as InaccurateIcon,
  ChartColumn   as StatsIcon,
  CircleAlert   as OverdueIcon,
  Sparkles      as AiIcon,
}
