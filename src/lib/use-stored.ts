'use client'

import { useSyncExternalStore } from 'react'

/**
 * Reading a browser-only value without a hydration mismatch or an effect.
 *
 * `localStorage`, `Intl`'s resolved timezone and "has this hydrated yet" are all
 * things the server cannot know. The obvious approach — default state plus an
 * effect that overwrites it on mount — is what `react-hooks/set-state-in-effect`
 * objects to, and it is right to: the component renders once with a value it
 * knows is wrong, then again with the real one.
 *
 * `useSyncExternalStore` renders the server value during SSR and the real one on
 * the client, in a single pass that React knows about. The idiom was already
 * spelled out by hand in five places before this module existed.
 *
 * **Snapshots must be primitives.** React calls `read` on every render and
 * compares by identity, so returning a fresh object or array each time is an
 * infinite loop. Every preference here is a string, number or boolean.
 */

const listeners = new Set<() => void>()

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  // Another tab writing the same key. Free, and it is what a user expects from
  // two windows of the same app open side by side.
  if (typeof window !== 'undefined') window.addEventListener('storage', onChange)
  return () => {
    listeners.delete(onChange)
    if (typeof window !== 'undefined') window.removeEventListener('storage', onChange)
  }
}

/**
 * A browser-only value, safe to read during render.
 *
 * `serverValue` is what SSR renders — it has to be a value the markup can be
 * built from, not a placeholder that will flash.
 */
export function useStored<T extends string | number | boolean | null>(
  read: () => T,
  serverValue: T,
): T {
  return useSyncExternalStore(subscribe, read, () => serverValue)
}

/**
 * Write a stored preference and tell every reader.
 *
 * Without the notify, a component reading through `useStored` keeps its old
 * snapshot until something else happens to re-render it — which is exactly the
 * bug that made the previous code carry the value in local state *as well as*
 * in localStorage, and keep the two in step by hand.
 */
export function writeStored(write: () => void): void {
  write()
  for (const l of [...listeners]) l()
}

/**
 * False on the server, true once hydrated.
 *
 * For markup that genuinely cannot be rendered server-side — a theme toggle
 * whose current value is only known in the browser. Prefer `useStored` with a
 * real server value where one exists; this is the fallback for when there
 * isn't one.
 */
export function useHydrated(): boolean {
  return useStored(TRUE, false)
}

// Hoisted so the snapshot is identity-stable across renders.
const TRUE = () => true as const
