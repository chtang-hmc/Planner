import { describe, it, expect } from 'vitest'
import { staleEventIds, expiredEventIds } from '@/lib/google-calendar'

const row = (id: string, gcal_id: string) => ({ id, gcal_id })

describe('staleEventIds', () => {
  it('keeps what Google still has', () => {
    expect(staleEventIds([row('a', 'g1'), row('b', 'g2')], ['g1', 'g2'])).toEqual([])
  })

  it('returns the rows Google no longer reports', () => {
    // A deleted event is not marked deleted — a `singleEvents` pull just omits
    // it — so absence from the response is the only signal there is.
    expect(staleEventIds([row('a', 'g1'), row('b', 'g2')], ['g1'])).toEqual(['b'])
  })

  it('returns local ids, not Google ids — the delete is by primary key', () => {
    expect(staleEventIds([row('local-uuid', 'google-id')], [])).toEqual(['local-uuid'])
  })

  it('ignores events Google has that we do not', () => {
    // The upsert adds those; this function is only about the other direction.
    expect(staleEventIds([row('a', 'g1')], ['g1', 'g2', 'g3'])).toEqual([])
  })

  it('handles an empty window without inventing work', () => {
    expect(staleEventIds([], ['g1'])).toEqual([])
  })
})

describe('expiredEventIds', () => {
  const windowStart = new Date('2026-09-16T00:00:00Z')
  const row = (id: string, end_time: string) => ({ id, end_time })
  const none = new Set<string>()

  it('expires what ended before the window begins', () => {
    expect(expiredEventIds({
      local: [row('old', '2026-09-07T10:00:00Z'), row('recent', '2026-09-20T10:00:00Z')],
      windowStart, linkedIds: none,
    })).toEqual(['old'])
  })

  it('keeps an event a task is linked to, however old', () => {
    // The link cascades on delete, and it is a decision someone made by hand.
    expect(expiredEventIds({
      local: [row('linked', '2026-08-01T10:00:00Z')],
      windowStart, linkedIds: new Set(['linked']),
    })).toEqual([])
  })

  it('keeps an event that ends exactly at the boundary', () => {
    expect(expiredEventIds({
      local: [row('edge', '2026-09-16T00:00:00Z')],
      windowStart, linkedIds: none,
    })).toEqual([])
  })

  it('judges on the end, not the start — a meeting running into the window stays', () => {
    expect(expiredEventIds({
      local: [row('spanning', '2026-09-16T09:00:00Z')],
      windowStart, linkedIds: none,
    })).toEqual([])
  })
})
