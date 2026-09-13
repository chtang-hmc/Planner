import { Task, computeUrgency } from '@/types'

// Re-export for convenience — the pure function lives in types/index.ts
// so it can be shared with the Supabase pg_cron SQL equivalent.
export { computeUrgency }

// Sort tasks by urgency score descending, with energy-level filter support
export function sortByUrgency(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => b.urgency_score - a.urgency_score)
}

// Filter tasks appropriate for current energy level
// High energy: show all. Medium: hide high-energy tasks. Low: only low-energy tasks.
export function filterByEnergy(tasks: Task[], currentEnergy: 'low' | 'medium' | 'high'): Task[] {
  if (currentEnergy === 'high') return tasks
  if (currentEnergy === 'medium') return tasks.filter(t => t.energy_required !== 'high')
  return tasks.filter(t => t.energy_required === 'low')
}

// Find tasks that fit within a given time window (in minutes)
export function findTasksForGap(tasks: Task[], availableMinutes: number): Task[] {
  return sortByUrgency(
    tasks.filter(t => {
      const estimate = t.adjusted_minutes ?? t.estimated_minutes
      return estimate != null && estimate <= availableMinutes
    })
  ).slice(0, 5)
}
