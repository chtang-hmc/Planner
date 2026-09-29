import { describe, expect, it } from 'vitest'
import { parseScopes, READ_SCOPE, signInAction, WRITE_SCOPE } from './google-scopes'

describe('parseScopes', () => {
  it('splits, dedupes and sorts what Google returns', () => {
    expect(parseScopes(`${WRITE_SCOPE} openid ${READ_SCOPE}  openid`)).toEqual([READ_SCOPE, WRITE_SCOPE, 'openid'].sort())
    expect(parseScopes(undefined)).toEqual([])
  })
})

describe('signInAction', () => {
  it('stores the first connection', () => {
    expect(signInAction(null, [READ_SCOPE])).toBe('insert')
  })
  it('never lets a read-only sign-in narrow a write connection (#116)', () => {
    expect(signInAction([READ_SCOPE, WRITE_SCOPE], [READ_SCOPE, 'openid'])).toBe('keep')
  })
  it('takes the fresher tokens when the new grant covers the stored one', () => {
    expect(signInAction([READ_SCOPE], [READ_SCOPE, 'openid'])).toBe('replace')
    // include_granted_scopes brings the earlier write grant back with the sign-in.
    expect(signInAction([READ_SCOPE, WRITE_SCOPE], [READ_SCOPE, WRITE_SCOPE, 'openid'])).toBe('replace')
  })
})
