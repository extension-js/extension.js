import {vi} from 'vitest'

// For work whose collaborators answer without real I/O: its timers run on a
// fake clock, so a pause costs nothing and its length can be asserted.
export async function onFakeClock<T>(
  work: () => Promise<T>
): Promise<{value: T; waitedMs: number}> {
  vi.useFakeTimers()

  try {
    const started = Date.now()
    let settled: {value: T} | {error: unknown} | undefined

    void work().then(
      (value) => {
        settled = {value}
      },
      (error: unknown) => {
        settled = {error}
      }
    )

    await vi.advanceTimersByTimeAsync(0)
    while (!settled) await vi.advanceTimersByTimeAsync(50)

    if ('error' in settled) throw settled.error

    return {value: settled.value, waitedMs: Date.now() - started}
  } finally {
    vi.useRealTimers()
  }
}
