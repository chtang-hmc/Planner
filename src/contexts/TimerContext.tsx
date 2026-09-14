'use client'

import {
  createContext, useContext, useState, useEffect,
  useRef, useCallback, ReactNode,
} from 'react'
import { Task, Project } from '@/types'
import { startFocusSession, finishFocusSession, abandonFocusSession } from '@/app/actions/tasks'

type Phase = 'idle' | 'running' | 'paused'

interface TimerCtx {
  phase:     Phase
  task:      (Task & { project: Project }) | null
  elapsedMs: number
  targetMs:  number
  start:   (task: Task & { project: Project }) => Promise<void>
  pause:   () => void
  resume:  () => void
  finish:  (estimateAccurate: boolean | null, blockerNote: string | null) => Promise<void>
  abandon: () => Promise<void>
}

const Ctx = createContext<TimerCtx | null>(null)

export function TimerProvider({ children }: { children: ReactNode }) {
  const [phase,     setPhase]     = useState<Phase>('idle')
  const [task,      setTask]      = useState<(Task & { project: Project }) | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [targetMs,  setTargetMs]  = useState(25 * 60 * 1000)

  // Refs track time without triggering re-renders on every tick
  const startedAtRef    = useRef<number | null>(null)   // epoch ms when running started/resumed
  const pausedElapsedRef = useRef(0)                    // ms accumulated before current run

  const tickRef    = useRef<ReturnType<typeof setInterval> | null>(null)
  const startingRef = useRef(false)   // prevents double-click race on start()

  const clearTick = useCallback(() => {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null }
  }, [])

  const startTick = useCallback(() => {
    clearTick()
    tickRef.current = setInterval(() => {
      if (startedAtRef.current !== null) {
        setElapsedMs(Date.now() - startedAtRef.current + pausedElapsedRef.current)
      }
    }, 500)
  }, [clearTick])

  const start = useCallback(async (t: Task & { project: Project }) => {
    // Guard against double-click before the first await resolves
    if (phase !== 'idle' || startingRef.current) return
    startingRef.current = true
    try {
      const sid = await startFocusSession(t.id)
      const target = (t.estimated_minutes ?? 25) * 60 * 1000
      pausedElapsedRef.current = 0
      startedAtRef.current = Date.now()
      setTask(t)
      setSessionId(sid)
      setTargetMs(target)
      setElapsedMs(0)
      setPhase('running')
      startTick()
    } finally {
      startingRef.current = false
    }
  }, [phase, startTick])

  const pause = useCallback(() => {
    if (phase !== 'running') return
    pausedElapsedRef.current += Date.now() - (startedAtRef.current ?? Date.now())
    startedAtRef.current = null
    setPhase('paused')
    clearTick()
  }, [phase, clearTick])

  const resume = useCallback(() => {
    if (phase !== 'paused') return
    startedAtRef.current = Date.now()
    setPhase('running')
    startTick()
  }, [phase, startTick])

  const finish = useCallback(async (
    estimateAccurate: boolean | null,
    blockerNote: string | null,
  ) => {
    if (!sessionId) return
    clearTick()
    const durationMinutes = Math.max(1, Math.round(elapsedMs / 60_000))
    await finishFocusSession(sessionId, durationMinutes, estimateAccurate, blockerNote)
    setPhase('idle')
    setTask(null)
    setSessionId(null)
    setElapsedMs(0)
    pausedElapsedRef.current = 0
    startedAtRef.current = null
  }, [sessionId, elapsedMs, clearTick])

  const abandon = useCallback(async () => {
    clearTick()
    setPhase('idle')
    setTask(null)
    setElapsedMs(0)
    pausedElapsedRef.current = 0
    startedAtRef.current = null
    // Delete the orphaned DB row — capture and clear sessionId before the async call
    const sid = sessionId
    setSessionId(null)
    if (sid) await abandonFocusSession(sid).catch(err =>
      console.error('abandonFocusSession failed:', err)
    )
  }, [sessionId, clearTick])

  useEffect(() => () => clearTick(), [clearTick])

  return (
    <Ctx.Provider value={{ phase, task, elapsedMs, targetMs, start, pause, resume, finish, abandon }}>
      {children}
    </Ctx.Provider>
  )
}

export function useTimer(): TimerCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useTimer must be inside TimerProvider')
  return ctx
}
