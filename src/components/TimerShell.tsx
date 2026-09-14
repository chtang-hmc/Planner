'use client'

import { TimerProvider } from '@/contexts/TimerContext'
import FloatingTimer from '@/components/FloatingTimer'

export default function TimerShell({ children }: { children: React.ReactNode }) {
  return (
    <TimerProvider>
      {children}
      <FloatingTimer />
    </TimerProvider>
  )
}
