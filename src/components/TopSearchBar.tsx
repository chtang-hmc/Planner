'use client'

import Link from 'next/link'
import { useEffect, useRef } from 'react'
import { useSearch } from '@/contexts/SearchContext'
import { SettingsIcon } from '@/components/icons'

export default function TopSearchBar() {
  const { query, setQuery } = useSearch()
  const inputRef = useRef<HTMLInputElement>(null)

  // ⌘K / Ctrl+K focuses the bar
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setQuery('')
      inputRef.current?.blur()
    }
  }

  return (
    <div className="shrink-0 border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur px-4 py-2 flex items-center gap-2">
      <div className="flex-1 min-w-0 flex items-center gap-2.5 px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 focus-within:bg-white dark:focus-within:bg-slate-700 focus-within:ring-2 focus-within:ring-accent-500 transition-all">
        <span className="text-slate-400 dark:text-slate-500 text-sm shrink-0">⌕</span>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Filter tasks…"
          className="flex-1 text-sm text-slate-900 dark:text-slate-100 bg-transparent focus:outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500"
        />
        {query ? (
          <button
            onClick={() => { setQuery(''); inputRef.current?.focus() }}
            className="text-slate-300 dark:text-slate-600 hover:text-slate-500 dark:hover:text-slate-400 transition-colors text-xs shrink-0"
          >
            ✕
          </button>
        ) : (
          <kbd className="hidden sm:inline-flex text-xs text-slate-300 dark:text-slate-600 font-mono shrink-0">⌘K</kbd>
        )}
      </div>

      {/* Settings only appears here below 640, where the sidebar that holds it
          is gone. It is a gear rather than a tab: it was never a peer of Today
          and Tasks, and five tabs is the comfortable maximum at 390. */}
      <Link
        href="/settings"
        aria-label="Settings"
        className="narrow:hidden shrink-0 flex items-center justify-center rounded-lg
                   text-ink-muted hover:text-ink-2 hover:bg-surface-quiet transition-colors"
        style={{ width: 'var(--tap-min)', height: 'var(--tap-min)' }}
      >
        <SettingsIcon size={16} />
      </Link>
    </div>
  )
}
