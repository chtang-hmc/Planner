/**
 * Two events in the same hour — and the one case that is not a conflict.
 *
 * **Containment is not a conflict.** An event entirely inside a longer one is
 * usually deliberate: a meeting inside a blocked-out working session, a talk
 * inside a conference. Flagging those trains you to ignore the chip, and the
 * chip is then worthless for the case that matters.
 *
 * The case that matters is a *partial* overlap — two things that each claim
 * time the other also claims, neither containing the other. That is a genuine
 * double-booking and nothing in the app currently says so.
 *
 * The same distinction matters to `capacity()`, and there it is not cosmetic:
 * free time is computed by subtracting busy spans from the working window, so
 * a nested event takes away nothing the longer one had not already taken. A
 * capacity that summed event durations instead would double-count it and
 * under-report free time. `freeGaps` subtracts rather than sums, so it is
 * already right; this note is here because the next person to write a total is
 * the one who gets it wrong.
 */

export interface ConflictEvent {
  id:      string
  title:   string
  startMs: number
  endMs:   number
}

export interface Conflict {
  /** The earlier of the pair, which carries the chip. */
  earlier: ConflictEvent
  later:   ConflictEvent
  /** Minutes the two actually share. */
  overlapMinutes: number
}

/** True when `a` wholly contains `b` — deliberate nesting, not a clash. */
export function contains(a: ConflictEvent, b: ConflictEvent): boolean {
  return a.startMs <= b.startMs && a.endMs >= b.endMs
}

/**
 * Partially overlapping pairs, earliest first.
 *
 * Every pair is reported once, on the event that starts first, so a day header
 * can count them and exactly one row in each pair carries the chip.
 */
export function findConflicts(events: ConflictEvent[]): Conflict[] {
  const sorted = [...events].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)
  const out: Conflict[] = []

  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i], b = sorted[j]
      if (b.startMs >= a.endMs) break            // sorted: nothing later can overlap either
      if (contains(a, b) || contains(b, a)) continue

      out.push({
        earlier: a, later: b,
        overlapMinutes: Math.round((Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs)) / 60_000),
      })
    }
  }
  return out
}

/** Ids that should carry the chip — the earlier event of each clashing pair. */
export function conflictedIds(conflicts: Conflict[]): Set<string> {
  return new Set(conflicts.flatMap(c => [c.earlier.id, c.later.id]))
}
