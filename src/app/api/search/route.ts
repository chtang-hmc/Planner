import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim()
  if (!q || q.length < 1) return NextResponse.json({ tasks: [] })

  const db = createServiceClient()

  const { data, error } = await db
    .from('tasks')
    .select('*, project:projects(id,name,color,archived,created_at)')
    .or(`title.ilike.%${q}%,description.ilike.%${q}%`)
    .in('status', ['inbox', 'active', 'done'])
    .order('urgency_score', { ascending: false })
    .limit(30)

  if (error) return NextResponse.json({ tasks: [] }, { status: 500 })

  // Put active tasks first, done second
  const sorted = (data ?? []).sort((a, b) => {
    const aActive = a.status !== 'done' ? 0 : 1
    const bActive = b.status !== 'done' ? 0 : 1
    if (aActive !== bActive) return aActive - bActive
    return b.urgency_score - a.urgency_score
  })

  return NextResponse.json({ tasks: sorted })
}
