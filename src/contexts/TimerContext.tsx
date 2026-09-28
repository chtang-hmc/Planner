'use client'

import {
  createContext, useContext, useState, useEffect,
  useRef, useCallback, useMemo, ReactNode,
} from 'react'
import { Task, Project } from '@/types'
import { startFocusSession, finishFocusSession, abandonFocusSession } from '@/app/actions/tasks'

type Phase = 'idle' | 'running' | 'paused'

/**
 * Two contexts, not one (#97).
 *
 * `elapsedMs` changes every 500ms while a timer runs. When it sat in the same
 * value as everything else, every `useTimer()` consumer — the whole of Home,
 * the task panel — re-rendered twice a second for a number only the floating
 * timer shows. Now `useTimer()` carries what changes on a user action (phase,
 * task, the controls) and `useTimerElapsed()` carries the tick; only
 * `FloatingTimer` reads the second.
 */
interface TimerCtx {
  phase:     Phase
  task:      (Task & { project: Project }) | null
  targetMs:  number
  start:   (task: Task & { project: Project }) => Promise<void>
  pause:   () => void
  resume:  () => void
  finish:  (estimateAccurate: boolean | null, blockerNote: string | null) => Promise<void>
  abandon: () => Promise<void>
}

const Ctx = createContext<TimerCtx | null>(null)
const ElapsedCtx = createContext<number | null>(null)

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
    // From the refs rather than `elapsedMs`: exact rather than up to one tick
    // stale, and it keeps this callback stable across ticks, so the memoised
    // control value below does not change twice a second.
    const elapsed = pausedElapsedRef.current
      + (startedAtRef.current !== null ? Date.now() - startedAtRef.current : 0)
    const durationMinutes = Math.max(1, Math.round(elapsed / 60_000))
    await finishFocusSession(sessionId, durationMinutes, estimateAccurate, blockerNote)
    setPhase('idle')
    setTask(null)
    setSessionId(null)
    setElapsedMs(0)
    pausedElapsedRef.current = 0
    startedAtRef.current = null
  }, [sessionId, clearTick])

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

  const control = useMemo(
    () => ({ phase, task, targetMs, start, pause, resume, finish, abandon }),
    [phase, task, targetMs, start, pause, resume, finish, abandon],
  )

  return (
    <Ctx.Provider value={control}>
      <ElapsedCtx.Provider value={elapsedMs}>
        {children}
      </ElapsedCtx.Provider>
    </Ctx.Provider>
  )
}

export function useTimer(): TimerCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useTimer must be inside TimerProvider')
  return ctx
}

/** Milliseconds on the running timer. Re-renders every tick; read it only where it is drawn. */
export function useTimerElapsed(): number {
  const ms = useContext(ElapsedCtx)
  if (ms === null) throw new Error('useTimerElapsed must be inside TimerProvider')
  return ms
}
