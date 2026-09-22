'use client'

/**
 * Navigation below 640px.
 *
 * The sidebar is 236px of a 390px viewport and has no collapsed state that
 * helps at that width, so below `--bp-narrow` it is replaced rather than
 * shrunk. Five destinations, which is the comfortable maximum at 390 and
 * exactly the number that earn a permanent slot.
 *
 * **Review and Settings are deliberately not here.**
 *
 * Review is a weekly ritual, not a daily destination. It has two entry points
 * instead: the permanent link at the top of Insights, and — once it exists —
 * a banner on Today on the day it is due. Settings is a gear in the top bar,
 * on every screen; it was never a peer of Today and Tasks.
 *
 * The bar is part of the column rather than fixed over it, so content scrolls
 * above it and nothing is ever hidden underneath. The sidebar's project list
 * has no place here: it is a workload glance, not navigation, and the Projects
 * tab carries the same information with room to read it.
 */

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: '/',          label: 'Today',    icon: TodayIcon },
  { href: '/tasks',     label: 'Tasks',    icon: TasksIcon },
  { href: '/habits',    label: 'Habits',   icon: HabitsIcon },
  { href: '/projects',  label: 'Projects', icon: ProjectsIcon },
  /* The page is Insights; the route is still /analytics. */
  { href: '/analytics', label: 'Insights', icon: InsightsIcon },
]

export default function MobileTabBar() {
  const path = usePathname()

  return (
    <nav
      aria-label="Main"
      className="narrow:hidden shrink-0 flex items-stretch h-[62px] border-t border-line bg-surface-sunk"
    >
      {TABS.map(({ href, label, icon: Icon }) => {
        /* Exact match for Home, prefix for the rest: `/` is a prefix of every
           path, and `/projects/abc` is still Projects. */
        const active = href === '/' ? path === '/' : path.startsWith(href)
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={`flex-1 basis-0 flex flex-col items-center justify-center gap-1 transition-colors ${
              active ? 'text-accent-600' : 'text-ink-muted hover:text-ink-2'
            }`}
          >
            <Icon />
            <span className={`text-[9.5px] ${active ? 'font-semibold' : ''}`}>{label}</span>
          </Link>
        )
      })}
    </nav>
  )
}

/* Line icons at a single weight, drawn here rather than pulled from a set: the
   five are used in one place and each is four paths. `currentColor` is what
   makes the active state one class rather than five. */
const S = {
  width: 18, height: 18, viewBox: '0 0 20 20', fill: 'none',
  stroke: 'currentColor', strokeWidth: 1.5, 'aria-hidden': true,
} as const

function TodayIcon() {
  return (
    <svg {...S}>
      <rect x="3" y="4.5" width="14" height="12.5" rx="2" />
      <path d="M3 8.5 L17 8.5 M7 3 L7 6 M13 3 L13 6" />
    </svg>
  )
}

function TasksIcon() {
  return <svg {...S}><path d="M4 10.5 L8 14.5 L16 5.5" /></svg>
}

function HabitsIcon() {
  return (
    <svg {...S}>
      <circle cx="10" cy="10" r="6.5" />
      <circle cx="10" cy="10" r="2" />
    </svg>
  )
}

function ProjectsIcon() {
  return (
    <svg {...S}>
      <rect x="3.5" y="3.5" width="5.5" height="5.5" rx="1" />
      <rect x="11" y="3.5" width="5.5" height="5.5" rx="1" />
      <rect x="3.5" y="11" width="5.5" height="5.5" rx="1" />
      <rect x="11" y="11" width="5.5" height="5.5" rx="1" />
    </svg>
  )
}

function InsightsIcon() {
  return <svg {...S}><path d="M4 16 L4 11 M8.5 16 L8.5 6 M13 16 L13 9 M17 16 L17 4" /></svg>
}
