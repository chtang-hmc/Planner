import { NextResponse } from 'next/server'
import { syncCalendarEvents } from '@/lib/google-calendar'

export async function POST() {
  try {
    const synced = await syncCalendarEvents()
    return NextResponse.json({ synced })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const status  = message.includes('not connected') ? 401 : 502
    console.error('Calendar sync error:', message)
    return NextResponse.json({ error: message }, { status })
  }
}
