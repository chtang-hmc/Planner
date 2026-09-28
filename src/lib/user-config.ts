import { cache } from 'react'
import { createServiceClient } from '@/lib/supabase/server'
import { DEFAULT_TZ, isValidTimezone } from '@/lib/day'
import { isWeekStartDay, WEEK_START_DEFAULT, type WeekStartDay } from '@/lib/week'
import { DEFAULT_BUFFER_MINUTES } from '@/lib/home'

/**
 * The one `user_scheduling_config` row, read once per request (#96).
 *
 * `fetchTimezone` and `fetchWeekStartDay` each `select('*')` this same row, and
 * a page used to call them one after the other — with the layout reading it
 * again for the sidebar's date. `/tasks` read it three times in sequence, and
 * Home's landing path was four round trips where two would do.
 *
 * `cache()` dedupes it across the layout and the page within one request, so
 * whichever asks first pays and everything else waits on the same promise.
 * It takes no arguments on purpose: `cache` keys on its arguments, and a
 * Supabase client is a new object every time, which would miss every time.
 *
 * `row` is the raw row for the few readers that need other columns (the
 * relevance filter, Settings). `null` before the user has saved anything;
 * every field below then carries its default. `select('*')` so a database
 * missing a later migration still returns the row without those columns.
 */
export interface UserConfig {
  timezone:      string
  weekStartDay:  WeekStartDay
  bufferMinutes: number
  row:           Record<string, unknown> | null
}

export const fetchUserConfig = cache(async (): Promise<UserConfig> => {
  const { data } = await createServiceClient()
    .from('user_scheduling_config')
    .select('*')
    .limit(1)
    .maybeSingle()
  const row = (data ?? null) as Record<string, unknown> | null
  return {
    timezone:      isValidTimezone(row?.timezone) ? row!.timezone as string : DEFAULT_TZ,
    weekStartDay:  isWeekStartDay(row?.week_start_day) ? row!.week_start_day as WeekStartDay : WEEK_START_DEFAULT,
    bufferMinutes: typeof row?.buffer_minutes === 'number' ? row.buffer_minutes : DEFAULT_BUFFER_MINUTES,
    row,
  }
})
