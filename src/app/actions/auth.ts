'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

/**
 * Where Google should send you back to — the host you actually asked from.
 *
 * This used to be `NEXT_PUBLIC_SITE_URL` alone, baked in at build time as
 * `http://localhost:3000`. Open the app from anything that is not the machine
 * running it — a phone on the same network, a tunnel — and sign-in sent you to
 * *your own* localhost, which is nothing.
 *
 * The host header is attacker-controllable in general, and the usual worry is
 * an open redirect. It is not one here: Supabase refuses any `redirectTo`
 * outside the redirect allow-list configured on the project, so the allow-list
 * is the control, and it is the right place for it — one list, checked
 * server-side, rather than an env var per host.
 *
 * `NEXT_PUBLIC_SITE_URL` stays as the fallback for anything with no request
 * behind it.
 */
async function siteUrl(): Promise<string> {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host')
  if (!host) return process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'

  // A tunnel terminates TLS in front of us and says so; a LAN address does not.
  const proto = h.get('x-forwarded-proto')
    ?? (host.startsWith('localhost') || /^\d/.test(host) ? 'http' : 'https')
  return `${proto}://${host}`
}

export async function signInWithGoogle() {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${await siteUrl()}/auth/callback`,
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
