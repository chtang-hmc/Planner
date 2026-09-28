import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono, Instrument_Serif } from 'next/font/google'
import './globals.css'
import Providers from '@/components/Providers'

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })
const geistMono = Geist_Mono({ variable: '--font-mono-src', subsets: ['latin'] })

/**
 * Claims only — a page title, the capacity sentence, a finding headline. Never
 * a label, never a control, never a table cell.
 *
 * One weight, no italic, and it appears on roughly one line per screen, so the
 * payload is small. The redesign originally asked for IBM Plex Sans as well;
 * three families undercut an argument about being fast to read, so the UI text
 * stays on Geist and only the display face is new.
 */
const instrumentSerif = Instrument_Serif({
  variable: '--font-display-src', subsets: ['latin'], weight: '400',
})

export const metadata: Metadata = {
  title: 'Planner',
  description: 'Personal task planner',
  /**
   * Opened from the home screen, iOS runs this as its own app: full-screen,
   * its own icon, and — from iOS 16.4 — able to receive web push. `default`
   * keeps the status bar opaque above the page rather than drawn over it, so
   * nothing has to pad for the notch at the top.
   */
  appleWebApp: { capable: true, title: 'Planner', statusBarStyle: 'default' },
  /* A real .png path, not the app/apple-icon convention: that one is served
     at `/apple-icon?<hash>`, which has no extension and so is not a static
     file to the proxy — a signed-out fetch of it would redirect to /login. */
  icons: { apple: '/icons/apple-touch-icon.png' },
}

/**
 * `cover` lets the page run to the bottom edge of an iPhone, under the home
 * indicator, so the tab bar can pad itself by the safe-area inset instead of
 * sitting on a band iOS leaves blank. The theme colours are the paper preset's
 * ground in each scheme.
 */
export const viewport: Viewport = {
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FAF8F4' },
    { media: '(prefers-color-scheme: dark)', color: '#141210' },
  ],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    /* The font variables go on <html>, not <body>. Tailwind's preflight sets
       the default family on `html`, so a variable defined on `body` is not in
       scope where it is read and the whole app silently falls back to the
       system stack — which is what it had been doing. */
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
