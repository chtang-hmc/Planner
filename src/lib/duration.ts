/**
 * A duration in a column.
 *
 * `formatMinutes` in lib/task-format.ts renders `1h` beside `1h 15m`, which
 * reads fine in a sentence and ruins a column: the minutes place moves. Padded
 * to `Xh YYm` the digits line up, and with `.num` (tabular figures, see
 * globals.css) a list of durations becomes something you can scan down rather
 * than read one at a time.
 *
 * Two functions rather than a flag, because the two uses are genuinely
 * different and a caller should have to say which it means:
 *
 *   formatDuration(60)  → "1h 00m"   in a column
 *   formatMinutes(60)   → "1h"       in a sentence
 */

/** `1h 00m`, `2h 30m`, `45m`. Null or zero is an em dash, never "0m". */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes == null || minutes <= 0) return '—'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`
}
