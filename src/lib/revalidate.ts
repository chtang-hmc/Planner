import { revalidatePath } from 'next/cache'

/**
 * Bust every surface that draws tasks.
 *
 * `/` (Home) and `/tasks` read the same rows, so a mutation that refreshes one
 * and not the other leaves a stale page one navigation away. There were
 * twenty-six `revalidatePath('/tasks')` calls when Home was built, and adding a
 * second line to each of them is a rule nobody would keep — the next surface
 * that reads tasks changes this function instead.
 */
export function revalidateTaskViews() {
  revalidatePath('/')
  revalidatePath('/tasks')
}
