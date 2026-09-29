import { describe, expect, it } from 'vitest'
import { allowedEmails, isAllowed, ownsCalendar } from './allowed-emails'

const TWO = 'chtang@g.hmc.edu, tangchengyi42@gmail.com'

describe('allowedEmails', () => {
  it('reads one address or a comma-separated list, trimmed and lowercased', () => {
    expect(allowedEmails('chtang@g.hmc.edu')).toEqual(['chtang@g.hmc.edu'])
    expect(allowedEmails(' A@x.com ,b@y.com,, ')).toEqual(['a@x.com', 'b@y.com'])
    expect(allowedEmails(undefined)).toEqual([])
  })
})

describe('isAllowed', () => {
  it('lets in every address on the list, in any case', () => {
    expect(isAllowed('chtang@g.hmc.edu', TWO)).toBe(true)
    expect(isAllowed('TangChengyi42@gmail.com', TWO)).toBe(true)
  })
  it('keeps everyone else out, including a missing email', () => {
    expect(isAllowed('someone@gmail.com', TWO)).toBe(false)
    expect(isAllowed(undefined, TWO)).toBe(false)
    // A prefix of an allowed address is not that address.
    expect(isAllowed('chtang@g.hmc.ed', TWO)).toBe(false)
  })
  it('has no gate when the variable is unset, as before', () => {
    expect(isAllowed('anyone@x.com', undefined)).toBe(true)
    expect(isAllowed('anyone@x.com', '')).toBe(true)
  })
})

describe('ownsCalendar', () => {
  it('is the first address only, so a second account never replaces the calendar', () => {
    expect(ownsCalendar('chtang@g.hmc.edu', TWO)).toBe(true)
    expect(ownsCalendar('tangchengyi42@gmail.com', TWO)).toBe(false)
  })
  it('is anyone when there is no list', () => {
    expect(ownsCalendar('a@x.com', undefined)).toBe(true)
  })
})
