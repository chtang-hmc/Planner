import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    // Same `@/` alias tsconfig uses, so tests import modules the way the app does.
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['src/**/*.test.ts'],
    // These suites cover pure functions — date maths, urgency, the scheduler.
    // Nothing here touches the database, the network or the DOM, which is what
    // keeps them fast enough to run on every change.
    environment: 'node',
  },
})
