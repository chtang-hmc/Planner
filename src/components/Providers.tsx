'use client'

import { ThemeProvider } from 'next-themes'
import { useEffect } from 'react'
import { SearchProvider } from '@/contexts/SearchContext'

// ── Accent provider ───────────────────────────────────────────────────────────
// Reads the stored accent choice and applies it as data-accent on <html>.
// Lives here so it can share the same client bundle as ThemeProvider.

const ACCENT_KEY = 'planner-accent'
export const ACCENT_DEFAULT = 'teal'

export const ACCENTS = [
  { id: 'teal',   label: 'Teal',   color: '#14b8a6' },
  { id: 'indigo', label: 'Indigo', color: '#6366f1' },
  { id: 'violet', label: 'Violet', color: '#8b5cf6' },
  { id: 'rose',   label: 'Rose',   color: '#f43f5e' },
  { id: 'amber',  label: 'Amber',  color: '#f59e0b' },
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
