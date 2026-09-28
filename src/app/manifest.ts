import type { MetadataRoute } from 'next'

/**
 * What makes Planner installable to the home screen (served at
 * /manifest.webmanifest). Standalone, so it opens full-screen with no Safari
 * chrome — and it is the installed app that iOS 16.4+ will deliver web push to,
 * which is what the next step builds on.
 *
 * The colours are the paper preset's ground in each theme. A manifest cannot
 * follow the user's accent preset, which lives in the browser; the splash is
 * on screen for a moment and the ground is what the app itself opens on.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Planner',
    short_name: 'Planner',
    description: 'Personal task planner',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#FAF8F4',
    theme_color: '#FAF8F4',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
