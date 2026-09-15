'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

const siteUrl = () =>
  process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'

export async function signInWithGoogle() {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${siteUrl()}/auth/callback`,
      // Request calendar scope alongside auth so the user only sees one consent screen.
      // access_type: offline + prompt: consent ensures Google always returns a refresh token.
      scopes: 'https://www.googleapis.com/auth/calendar.readonly',
      queryParams: {
        access_type: 'offline',
        prompt: 'consent',
      },
    },
  })
  if (error) throw new Error(error.message)
  if (data.url) redirect(data.url)
}

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}
