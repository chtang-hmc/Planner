'use client'

import Link from 'next/link'
import { SettingsIcon } from '@/components/icons'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useStored } from '@/lib/use-stored'
import { Project } from '@/types'
import { signOut } from '@/app/actions/auth'
import EnergyLogger from './EnergyLogger'
import {
  SIDEBAR_RAIL_WIDTH, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH, SIDEBAR_DEFAULT_WIDTH,
  clampSidebarWidth, getStoredSidebarWidth, storeSidebarWidth,
  getStoredSidebarCollapsed, storeSidebarCollapsed,
} from '@/lib/sidebar-prefs'

const NAV = [
  { href: '/',          label: 'Home',      icon: '◆' },
  { href: '/tasks',     label: 'Tasks',     icon: '✓' },
  { href: '/habits',    label: 'Habits',    icon: '◎' },
  { href: '/projects',  label: 'Projects',  icon: '⊞' },
  { href: '/review',    label: 'Review',    icon: '↻' },
  { href: '/analytics', label: 'Analytics', icon: '▸' },
]

export default function Sidebar({ projects, todayStr }: {
  projects: Project[]
  /**
   * Today, as a `YYYY-MM-DD` day string in the configured timezone, from the
   * layout.
   *
   * Not `new Date()` here. This component renders on the server and hydrates in
   * the browser, and the two run in different timezones once deployed — a UTC
   * server past 5pm Pacific already calls it tomorrow. The date line then
   * differs between the two renders and React discards the tree, on every page,
   * because the sidebar is on every page. It is also the wrong "today": the
   * app's day is the configured zone everywhere else, not the browser's.
   */
  todayStr: string
}) {
  const path = usePathname()

  // Stored preferences can only be read in the browser. The server renders the
  // defaults and the client swaps in the stored values on hydrate — no effect,
  // no mismatch. `override` holds anything changed since load.
  // Packed into one string because a snapshot must be identity-stable —
  // returning a fresh object each render is an infinite loop.
  const stored = useStored(
    () => `${getStoredSidebarWidth()}|${getStoredSidebarCollapsed() ? 1 : 0}`,
    `${SIDEBAR_DEFAULT_WIDTH}|0`,
  )
  const [storedWidth, storedCollapsed] = stored.split('|')

  const [widthOverride, setWidthOverride] = useState<number | null>(null)
  const [collapsedOverride, setCollapsedOverride] = useState<boolean | null>(null)

  const width     = widthOverride     ?? Number(storedWidth)
  const collapsed = collapsedOverride ?? storedCollapsed === '1'

  function toggleCollapsed() {
    const next = !collapsed
    setCollapsedOverride(next)
    storeSidebarCollapsed(next)
  }

  // ── Resize ────────────────────────────────────────────────────────────────
  //
  // Pointer events rather than mouse events so a trackpad or pen drags too, and
  // the listeners go on the window: the pointer leaves the 4px grip almost
  // immediately, and a handler bound to the grip would stop receiving moves.
  const dragging = useRef(false)
  const asideRef = useRef<HTMLElement>(null)

  const onPointerMove = useCallback((e: PointerEvent) => {
    if (!dragging.current) return
    // Measured from the sidebar's own left edge, not from the viewport. They
    // are the same in the app, but assuming x=0 makes the component only work
    // in that one position — and wrong anywhere it is previewed or embedded.
    const left = asideRef.current?.getBoundingClientRect().left ?? 0
    setWidthOverride(clampSidebarWidth(e.clientX - left))
  }, [])

  const endDrag = useCallback(() => {
    if (!dragging.current) return
    dragging.current = false
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    setWidthOverride(w => { if (w != null) storeSidebarWidth(w); return w })
  }, [])

  useEffect(() => {
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', endDrag)
    window.addEventListener('pointercancel', endDrag)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', endDrag)
      window.removeEventListener('pointercancel', endDrag)
    }
  }, [onPointerMove, endDrag])

  function startDrag(e: React.PointerEvent) {
    if (collapsed) return
    e.preventDefault()
    dragging.current = true
    // Held on the body so the cursor and the no-select survive the pointer
    // moving over anything else mid-drag.
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  /** Keyboard resize, so the grip is not mouse-only. */
  function onGripKey(e: React.KeyboardEvent) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const next = clampSidebarWidth(width + (e.key === 'ArrowRight' ? 16 : -16))
    setWidthOverride(next)
    storeSidebarWidth(next)
  }

  return (
    <aside
      ref={asideRef}
      style={{ width: collapsed ? SIDEBAR_RAIL_WIDTH : width }}
      className={`relative shrink-0 flex flex-col h-full border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 py-5 ${
        collapsed ? 'px-2' : 'px-3'
      }`}
    >
      {/* Resize grip — a hit area wider than the line it draws. */}
      {!collapsed && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          aria-valuenow={width}
          aria-valuemin={SIDEBAR_MIN_WIDTH}
          aria-valuemax={SIDEBAR_MAX_WIDTH}
          tabIndex={0}
          onPointerDown={startDrag}
          onKeyDown={onGripKey}
          onDoubleClick={() => { setWidthOverride(SIDEBAR_DEFAULT_WIDTH); storeSidebarWidth(SIDEBAR_DEFAULT_WIDTH) }}
          title="Drag to resize · double-click to reset"
          className="absolute top-0 right-0 h-full w-1.5 translate-x-1/2 z-20 cursor-col-resize group/grip focus:outline-none"
        >
          <div className="w-px h-full mx-auto bg-transparent group-hover/grip:bg-accent-400 group-focus/grip:bg-accent-400 transition-colors" />
        </div>
      )}

      {/* App name + collapse */}
      <div className={`mb-6 flex items-center ${collapsed ? 'justify-center' : 'justify-between px-2'}`}>
        {!collapsed && (
          <span className="text-sm font-semibold tracking-tight text-slate-900 dark:text-slate-100">Planner</span>
        )}
        <button
          onClick={toggleCollapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
          className="w-6 h-6 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          <span className="text-xs leading-none">{collapsed ? '›' : '‹'}</span>
        </button>
      </div>

      {/* Primary nav */}
      <nav className="flex flex-col gap-0.5 mb-6">
        {NAV.map(({ href, label, icon }) => {
          // '/' is a prefix of every route, and /tasks has no children, so both
          // are exact matches; everything else lights up for its subpages too.
          const active = path === href
            || (href !== '/' && href !== '/tasks' && path.startsWith(href))
          return (
            <Link
              key={href}
              href={href}
              title={collapsed ? label : undefined}
              className={`flex items-center gap-2.5 py-1.5 rounded-lg text-sm transition-colors ${
                collapsed ? 'justify-center px-0' : 'px-2.5'
              } ${
                active
                  ? 'bg-accent-50 dark:bg-accent-950 text-accent-700 dark:text-accent-300 font-medium'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/50'
              }`}
            >
              <span className={`text-xs font-mono w-4 text-center shrink-0 ${active ? 'text-accent-500' : 'opacity-50'}`}>
                {icon}
              </span>
              {!collapsed && label}
            </Link>
          )
        })}
      </nav>

      {/* Projects — the heading is the one thing with no useful rail form */}
      {collapsed
        ? <div className="h-px bg-slate-100 dark:bg-slate-800 mx-1 mb-2" />
        : (
          <div className="px-2 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-600">Projects</span>
          </div>
        )}
      <div className="flex flex-col gap-0.5 flex-1 overflow-y-auto">
        {projects.map(p => (
          <Link
            key={p.id}
            href={`/projects/${p.id}`}
            title={collapsed ? p.name : undefined}
            className={`flex items-center gap-2 py-1.5 rounded-lg text-sm text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors ${
              collapsed ? 'justify-center px-0' : 'px-2.5'
            }`}
          >
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
            {!collapsed && <span className="truncate">{p.name}</span>}
          </Link>
        ))}
      </div>

      {/* Bottom */}
      <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 flex flex-col gap-2">
        {!collapsed && <EnergyLogger />}

        {/* Settings link */}
        <Link
          href="/settings"
          title={collapsed ? 'Settings' : undefined}
          className={`flex items-center gap-2.5 py-1.5 rounded-lg text-xs transition-colors ${
            collapsed ? 'justify-center px-0' : 'px-2.5'
          } ${
            path === '/settings'
              ? 'bg-accent-50 dark:bg-accent-950 text-accent-700 dark:text-accent-300 font-medium'
              : 'text-slate-400 dark:text-slate-600 hover:text-slate-600 dark:hover:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50'
          }`}
        >
          <SettingsIcon size={14} className="w-4 shrink-0" />
          {!collapsed && 'Settings'}
        </Link>

        {!collapsed && (
          <div className="px-2.5 text-xs text-slate-400 dark:text-slate-600">
            {/* Noon UTC and timeZone UTC so the day cannot shift under formatting. */}
            {new Date(todayStr + 'T12:00:00Z').toLocaleDateString('en-US', {
              weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC',
            })}
          </div>
        )}

        <form action={signOut}>
          <button
            type="submit"
            title={collapsed ? 'Sign out' : undefined}
            className={`w-full flex items-center gap-2 py-1.5 rounded-lg text-xs text-slate-400 dark:text-slate-600 hover:text-slate-600 dark:hover:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors ${
              collapsed ? 'justify-center px-0' : 'px-2.5 text-left'
            }`}
          >
            <span className="font-mono shrink-0">→</span>{!collapsed && ' Sign out'}
          </button>
        </form>
      </div>
    </aside>
  )
}
