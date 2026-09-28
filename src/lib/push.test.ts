import { describe, expect, it } from 'vitest'
import { outcomeOf } from './push'

describe('outcomeOf', () => {
  it('treats any 2xx as delivered', () => {
    expect(outcomeOf(201)).toBe('sent')
    expect(outcomeOf(200)).toBe('sent')
  })

  it('deletes only on 404 and 410, the push service saying the subscription is gone', () => {
    expect(outcomeOf(404)).toBe('gone')
    expect(outcomeOf(410)).toBe('gone')
  })

  it('keeps the row for everything else, including no answer at all', () => {
    expect(outcomeOf(429)).toBe('failed')
    expect(outcomeOf(500)).toBe('failed')
    expect(outcomeOf(403)).toBe('failed')
    expect(outcomeOf(undefined)).toBe('failed')
  })
})
