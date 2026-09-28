import { describe, it, expect, afterEach, vi } from 'vitest'
import { originFrom, originOrConfigured } from './request-origin'

const h = (init: Record<string, string>) => new Headers(init)

describe('originFrom', () => {
  it('prefers the forwarded host, because that is what the browser asked', () => {
    expect(originFrom(h({ host: 'internal:3000', 'x-forwarded-host': 'planner.example.com', 'x-forwarded-proto': 'https' })))
      .toBe('https://planner.example.com')
  })

  it('trusts the forwarded protocol over any guess', () => {
    expect(originFrom(h({ host: 'planner.example.com', 'x-forwarded-proto': 'http' })))
      .toBe('http://planner.example.com')
  })

  it('assumes http for localhost and for a bare IP — the LAN case', () => {
    expect(originFrom(h({ host: 'localhost:3000' }))).toBe('http://localhost:3000')
    expect(originFrom(h({ host: '172.28.151.110:3000' }))).toBe('http://172.28.151.110:3000')
  })

  it('assumes https for a hostname with no forwarded protocol', () => {
    expect(originFrom(h({ host: 'planner.example.com' }))).toBe('https://planner.example.com')
  })

  it('is null with no host at all', () => {
    expect(originFrom(h({}))).toBeNull()
  })
})

describe('originOrConfigured', () => {
  afterEach(() => { vi.unstubAllEnvs() })

  it('uses the request origin when there is one', () => {
    expect(originOrConfigured(h({ host: 'planner.example.com' }))).toBe('https://planner.example.com')
  })

  it('falls back to the configured site when the header is missing', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://configured.example.com')
    expect(originOrConfigured(h({}))).toBe('https://configured.example.com')
  })

  /* The one that matters: a deployed sign-in must never redirect to the
     machine the server happens to be running on. */
  it('throws in production rather than falling back to localhost', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '')
    vi.stubEnv('NODE_ENV', 'production')
    expect(() => originOrConfigured(h({}))).toThrow(/Cannot determine the request origin/)
  })

  it('still falls back to localhost in development', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '')
    vi.stubEnv('NODE_ENV', 'development')
    expect(originOrConfigured(h({}))).toBe('http://localhost:3000')
  })
})
