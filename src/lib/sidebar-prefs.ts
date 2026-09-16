/**
 * Sidebar width and collapsed state.
 *
 * Per browser, like the task layout and the theme: it's about the window you're
 * looking at, not about the data. Both reads tolerate localStorage throwing,
 * which it does in a private window.
 */

export const SIDEBAR_DEFAULT_WIDTH = 208   // w-52, the width it always had
export const SIDEBAR_MIN_WIDTH     = 168   // below this, project names stop being readable
export const SIDEBAR_MAX_WIDTH     = 400
/** Icon-only rail. Wide enough for a 20px glyph plus the padding either side. */
export const SIDEBAR_RAIL_WIDTH    = 56

const WIDTH_KEY     = 'planner-sidebar-width'
const COLLAPSED_KEY = 'planner-sidebar-collapsed'

export function clampSidebarWidth(px: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(px)))
}

export function getStoredSidebarWidth(): number {
  if (typeof window === 'undefined') return SIDEBAR_DEFAULT_WIDTH
  try {
    const v = Number(window.localStorage.getItem(WIDTH_KEY))
    return Number.isFinite(v) && v > 0 ? clampSidebarWidth(v) : SIDEBAR_DEFAULT_WIDTH
  } catch {
    return SIDEBAR_DEFAULT_WIDTH
  }
}

export function storeSidebarWidth(px: number): void {
  try { window.localStorage.setItem(WIDTH_KEY, String(clampSidebarWidth(px))) } catch { /* private mode */ }
}

export function getStoredSidebarCollapsed(): boolean {
  if (typeof window === 'undefined') return false
  try { return window.localStorage.getItem(COLLAPSED_KEY) === '1' } catch { return false }
}

export function storeSidebarCollapsed(v: boolean): void {
  try { window.localStorage.setItem(COLLAPSED_KEY, v ? '1' : '0') } catch { /* private mode */ }
}
