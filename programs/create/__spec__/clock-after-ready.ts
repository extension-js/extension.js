import {vi} from 'vitest'

// Taken before any row fakes the clock, so the waits here stay real.
const realSetTimeout = globalThis.setTimeout

// Real children, a held clock: a timeout under test fires only once the row
// says its stand-in runs, so a loaded machine cannot fire it before the
// child starts. The caller fakes setTimeout before it starts the task.
export async function settleOnceReady<T>(
  task: Promise<T>,
  ready: () => boolean,
  {stepMs = 250, boundMs = 30_000} = {}
): Promise<T> {
  let settled = false
  const watched = task.finally(() => {
    settled = true
  })
  const deadline = Date.now() + boundMs
  // Seen twice, so a full turn of the event loop has read what the child
  // put in its pipes before it said it was ready.
  let seen = 0

  while (!settled) {
    if (Date.now() > deadline) {
      throw new Error('the stand-in never reached the point the row waits for')
    }

    seen = ready() ? seen + 1 : 0
    if (seen >= 2) vi.advanceTimersByTime(stepMs)

    await new Promise((resolve) => realSetTimeout(resolve, 20))
  }

  return watched
}

// Only the timer that ends the child is held, every other clock stays real.
export function holdTimeouts() {
  vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']})
}
