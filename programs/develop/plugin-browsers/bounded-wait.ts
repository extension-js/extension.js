// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗██╔════╝
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝███████╗
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗╚════██║
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║███████║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

type BoundedOutcome<T> =
  | {state: 'resolved'; value: T}
  | {state: 'rejected'; error: unknown}
  | {state: 'timeout'}

// Work awaited inside the compiler's done hook holds every later rebuild, so
// the hook stops waiting at the bound. The work itself keeps running.
export async function waitAtMost<T>(
  work: Promise<T>,
  ms: number
): Promise<BoundedOutcome<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined

  const timeout = new Promise<BoundedOutcome<T>>((resolve) => {
    timer = setTimeout(() => resolve({state: 'timeout'}), ms)
  })

  try {
    return await Promise.race([
      work.then(
        (value): BoundedOutcome<T> => ({state: 'resolved', value}),
        (error: unknown): BoundedOutcome<T> => ({state: 'rejected', error})
      ),
      timeout
    ])
  } finally {
    clearTimeout(timer)
  }
}
