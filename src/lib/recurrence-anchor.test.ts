import { describe, it, expect } from 'vitest'
import { getNextOccurrence, getFirstOccurrence } from './rrule-utils'

/**
 * What anchor a repeat advances from.
 *
 * `completeTask` normally anchors on the task's own `due_date`: finishing a
 * weekly review early gives the following week rather than re-spawning the
 * occurrence just closed. `every!` (migration 0015) anchors on the completion
 * instead. The two are pinned side by side because the difference is invisible
 * until you fall behind — which is exactly when it matters.
 */

const day = (d: string) => new Date(d + 'T00:00:00Z')

describe('due-date anchoring — the default', () => {
  it('keeps a weekly task on its original weekday when finished early', () => {
    // Due Sunday 20th, done on Monday 14th. The next one is the 27th, not the
    // 20th all over again.
    expect(getNextOccurrence('FREQ=WEEKLY;BYDAY=SU', day('2026-09-20')))
      .toBe('2026-09-27')
  })

  it('hands back a date already in the past when the task was left late', () => {
    // Due 1 Sep, every 3 days, finished on the 14th: the next occurrence is
    // the 4th — thirteen days before it was completed. This is the behaviour
    // `every!` exists to avoid, and it is correct for a deadline that really
    // is fixed (rent, a report), which is why it stays the default.
    const next = getNextOccurrence('FREQ=DAILY;INTERVAL=3', day('2026-09-01'))
    expect(next).toBe('2026-09-04')
    expect(next! < '2026-09-14').toBe(true)
  })
})

describe('completion anchoring — every!', () => {
  it('restarts the clock from when the work happened', () => {
    // Same rule and same neglect as above, anchored on the completion day.
    expect(getNextOccurrence('FREQ=DAILY;INTERVAL=3', day('2026-09-14')))
      .toBe('2026-09-17')
  })

  it('never hands back a date on or before the completion', () => {
    const completed = '2026-09-14'
    for (const rule of ['FREQ=DAILY', 'FREQ=DAILY;INTERVAL=3', 'FREQ=WEEKLY',
                        'FREQ=WEEKLY;INTERVAL=2', 'FREQ=MONTHLY', 'FREQ=YEARLY',
                        'FREQ=WEEKLY;BYDAY=MO,WE,FR', 'FREQ=MONTHLY;BYMONTHDAY=-1']) {
      const next = getNextOccurrence(rule, day(completed))
      expect(next, rule).not.toBeNull()
      expect(next! > completed, rule).toBe(true)
    }
  })

  it('leaves a fixed-date rule where it belongs', () => {
    // Anchoring changes *when the clock restarts*, not what the rule means: an
    // annual date is still that date, whenever you got to it.
    expect(getNextOccurrence('FREQ=YEARLY;BYMONTH=1;BYMONTHDAY=27', day('2026-09-14')))
      .toBe('2027-01-27')
  })

  it('is the whole difference when a repeat has been missed for a fortnight', () => {
    const rule = 'FREQ=DAILY;INTERVAL=3'
    const dueAnchored        = getNextOccurrence(rule, day('2026-09-01'))
    const completionAnchored = getNextOccurrence(rule, day('2026-09-15'))
    expect(dueAnchored).toBe('2026-09-04')          // two weeks in the past
    expect(completionAnchored).toBe('2026-09-18')   // three days from now
  })
})

describe('getFirstOccurrence vs getNextOccurrence', () => {
  /**
   * The pair a repeat needs at each end of its life: one to open the chain,
   * one to advance it. They differ only in whether the anchor day itself
   * counts, and that single flag is the difference between "every monday"
   * typed on a Monday meaning today and meaning a week from today.
   */
  it('differs exactly on whether the anchor day counts', () => {
    // 2026-09-21 is a Monday.
    expect(getFirstOccurrence('FREQ=WEEKLY;BYDAY=MO', '2026-09-21')).toBe('2026-09-21')
    expect(getNextOccurrence ('FREQ=WEEKLY;BYDAY=MO', day('2026-09-21'))).toBe('2026-09-28')
  })

  it('agrees when the anchor is not itself an occurrence', () => {
    // A Wednesday: neither helper can return it, so both give the Monday.
    expect(getFirstOccurrence('FREQ=WEEKLY;BYDAY=MO', '2026-09-16')).toBe('2026-09-21')
    expect(getNextOccurrence ('FREQ=WEEKLY;BYDAY=MO', day('2026-09-16'))).toBe('2026-09-21')
  })

  it('returns null rather than throwing on a rule it cannot read', () => {
    expect(getFirstOccurrence('not a rule', '2026-09-16')).toBeNull()
    expect(getNextOccurrence('not a rule', day('2026-09-16'))).toBeNull()
  })
})
