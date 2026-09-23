import { describe, it, expect } from 'vitest'
import { staleEventIds } from '@/lib/google-calendar'

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
