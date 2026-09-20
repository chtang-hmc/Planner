'use client'

import { ThemeProvider } from 'next-themes'
import { useEffect } from 'react'
import { SearchProvider } from '@/contexts/SearchContext'

// ── Accent provider ───────────────────────────────────────────────────────────
// Reads the stored accent choice and applies it as data-accent on <html>.
// Lives here so it can share the same client bundle as ThemeProvider.

const ACCENT_KEY = 'planner-accent'
export const ACCENT_DEFAULT = 'teal'

// Each entry also drives the neutral tint (see --tint-h in globals.css), so a
// choice here re-colors the whole UI, not just accented controls.
export const ACCENTS = [
  { id: 'teal',    label: 'Teal',    color: '#14b8a6' },
  { id: 'emerald', label: 'Emerald', color: '#10b981' },
  { id: 'sky',     label: 'Sky',     color: '#0ea5e9' },
  { id: 'indigo',  label: 'Indigo',  color: '#6366f1' },
  { id: 'violet',  label: 'Violet',  color: '#8b5cf6' },
  { id: 'pink',    label: 'Pink',    color: '#ec4899' },
  { id: 'rose',    label: 'Rose',    color: '#f43f5e' },
  { id: 'crimson', label: 'Red',     color: '#ef4444' },
  { id: 'amber',   label: 'Amber',   color: '#f59e0b' },
  // The redesign's identity, as a preset — see globals.css.
  { id: 'paper',   label: 'Paper',   color: '#A8431C' },
] as const

export type AccentId = (typeof ACCENTS)[number]['id']

export function applyAccent(id: AccentId) {
  document.documentElement.setAttribute('data-accent', id)
  localStorage.setItem(ACCENT_KEY, id)
}

export function getStoredAccent(): AccentId {
  if (typeof window === 'undefined') return ACCENT_DEFAULT
  const v = localStorage.getItem(ACCENT_KEY)
  return (ACCENTS.some(a => a.id === v) ? v : ACCENT_DEFAULT) as AccentId
}

function AccentMount() {
  useEffect(() => {
    document.documentElement.setAttribute('data-accent', getStoredAccent())
  }, [])
  return null
}

// ── Root providers ────────────────────────────────────────────────────────────

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <AccentMount />
      <SearchProvider>
        {children}
      </SearchProvider>
    </ThemeProvider>
  )
}
