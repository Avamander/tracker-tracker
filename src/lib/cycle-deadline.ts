// src/lib/cycle-deadline.ts
//
// Functions: withCycleDeadline

/**
 * Settles with `work`, or rejects once `deadlineMs` passes without it
 * settling. The scheduler's cron tick awaits a whole poll cycle behind an
 * in-flight latch that a finally clears; a cycle whose promise never settled
 * left that latch set until restart, so the await is bounded here rather than
 * trusted.
 */
export function withCycleDeadline<T>(
  work: Promise<T>,
  deadlineMs: number,
  label: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} exceeded its ${deadlineMs}ms deadline`))
    }, deadlineMs)
    work.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err: unknown) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}
