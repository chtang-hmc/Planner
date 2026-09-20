import { describe, it, expect } from 'vitest'
import { findConflicts, contains, conflictedIds, type ConflictEvent } from '@/lib/conflicts'

const h = (n: number) => n * 3_600_000
const ev = (id: string, from: number, to: number): ConflictEvent =>
  ({ id, title: id, startMs: h(from), endMs: h(to) })

describe('containment is not a conflict', () => {
  it('ignores an event entirely inside a longer one', () => {
    // Fall Fest 11:00-13:15 with ENTR 179A 11:00-12:15 inside it. Deliberate,
    // and flagging it would train you to ignore the chip.
    expect(findConflicts([ev('fest', 11, 13.25), ev('entr', 11, 12.25)])).toEqual([])
  })

  it('ignores it whichever order they are given in', () => {
    expect(findConflicts([ev('entr', 11, 12.25), ev('fest', 11, 13.25)])).toEqual([])
  })

  it('ignores an exact duplicate, which contains itself both ways', () => {
    expect(findConflicts([ev('a', 9, 10), ev('b', 9, 10)])).toEqual([])
  })

  it('knows which way containment runs', () => {
    expect(contains(ev('outer', 9, 12), ev('inner', 10, 11))).toBe(true)
    expect(contains(ev('inner', 10, 11), ev('outer', 9, 12))).toBe(false)
  })
})

describe('a partial overlap is the real thing', () => {
  it('reports a staggered pair, on the earlier one', () => {
    const [c] = findConflicts([ev('piano-a', 13, 14), ev('piano-b', 13.5, 14.5)])
    expect(c.earlier.id).toBe('piano-a')
    expect(c.later.id).toBe('piano-b')
    expect(c.overlapMinutes).toBe(30)
  })

  it('reports each pair once', () => {
    expect(findConflicts([ev('a', 9, 11), ev('b', 10, 12)])).toHaveLength(1)
  })

  it('finds every clashing pair on a bad day', () => {
    const cs = findConflicts([ev('a', 9, 11), ev('b', 10, 12), ev('c', 11.5, 13)])
    expect(cs.map(c => `${c.earlier.id}/${c.later.id}`)).toEqual(['a/b', 'b/c'])
  })

  it('does not call back-to-back events a clash', () => {
    // 11:00-12:00 then 12:00-13:00 share an instant, not a minute.
    expect(findConflicts([ev('a', 11, 12), ev('b', 12, 13)])).toEqual([])
  })

  it('names both sides, so either row can be tinted', () => {
    const ids = conflictedIds(findConflicts([ev('a', 9, 11), ev('b', 10, 12)]))
    expect([...ids].sort()).toEqual(['a', 'b'])
  })

  it('has nothing to say about a clear day', () => {
    expect(findConflicts([ev('a', 9, 10), ev('b', 11, 12)])).toEqual([])
    expect(findConflicts([])).toEqual([])
  })
})
