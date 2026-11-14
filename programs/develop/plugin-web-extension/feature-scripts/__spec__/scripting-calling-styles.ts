export type Script = Record<string, unknown> & {id: string}
export type Injection = Record<string, unknown> & {
  target: {tabId: number}
}
export type CallingStyle = 'promise' | 'callback-only'
type Callback = (...values: unknown[]) => void

export const CALLING_STYLES: CallingStyle[] = ['promise', 'callback-only']

// One registry behind any number of namespaces. The callback-only style
// hands nothing back, the way chrome.* does on a Manifest V2 Firefox.
export function fakeEngine(initial: Script[] = []) {
  let registry: Script[] = initial.map((script) => ({...script}))
  const injections: Injection[] = []
  // What the browser prints for an error no one read.
  const unread: string[] = []
  const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value))

  const list = (scripts: unknown): Script[] => {
    if (
      !Array.isArray(scripts) ||
      scripts.some((script) => typeof script?.id !== 'string')
    ) {
      throw new TypeError('Incorrect argument types')
    }

    return scripts
  }

  const methods = {
    registerContentScripts: (given: unknown) => {
      const scripts = list(given)

      return () => {
        for (const script of scripts) {
          if (script.id.startsWith('_')) {
            throw new Error(`Invalid content script id "${script.id}"`)
          }

          if (registry.some((known) => known.id === script.id)) {
            throw new Error(`Content script "${script.id}" already registered`)
          }
        }

        registry = [...registry, ...scripts.map(copy)]
      }
    },
    updateContentScripts: (given: unknown) => {
      const scripts = list(given)

      return () => {
        for (const script of scripts) {
          if (!registry.some((known) => known.id === script.id)) {
            throw new Error(`Content script "${script.id}" does not exist`)
          }
        }

        for (const script of scripts) {
          const known = registry.find((entry) => entry.id === script.id)
          registry = registry.filter((entry) => entry.id !== script.id)
          registry.push({...known, ...copy(script)})
        }
      }
    },
    unregisterContentScripts: (given: unknown) => {
      if (given !== undefined && (!given || typeof given !== 'object')) {
        throw new TypeError('Incorrect argument types')
      }

      const ids = (given as {ids?: string[]} | undefined)?.ids

      return () => {
        for (const id of ids || []) {
          if (!registry.some((known) => known.id === id)) {
            throw new Error(`Content script "${id}" does not exist`)
          }
        }

        registry = ids
          ? registry.filter((known) => !ids.includes(known.id))
          : []
      }
    },
    getRegisteredContentScripts: (given: unknown) => {
      const ids = (given as {ids?: string[]} | undefined)?.ids

      return () =>
        registry.filter((known) => !ids || ids.includes(known.id)).map(copy)
    },
    executeScript: (given: unknown) => {
      const injection = given as Injection | undefined

      if (!injection || typeof injection.target?.tabId !== 'number') {
        throw new TypeError('Incorrect argument types')
      }

      return () => {
        if (injection.target.tabId < 0) throw new Error('Invalid tab ID')

        injections.push(injection)

        return [{frameId: 0, result: null}]
      }
    }
  }

  const namespace = (style: CallingStyle) => {
    const runtime: {lastError?: {message: string}} = {}

    const answered = (run: () => unknown, callback: Callback | null) => {
      let value: unknown
      let failure: Error | null = null

      try {
        value = run()
      } catch (error) {
        failure = error as Error
      }

      if (!callback) {
        if (failure) unread.push(failure.message)

        return
      }

      if (!failure) return callback(value)

      let read = false
      const message = failure.message

      Object.defineProperty(runtime, 'lastError', {
        configurable: true,
        get: () => {
          read = true

          return {message}
        }
      })

      try {
        callback()
      } finally {
        delete runtime.lastError
        if (!read) unread.push(message)
      }
    }

    const scripting = Object.fromEntries(
      Object.entries(methods).map(([name, check]) => [
        name,
        (...args: unknown[]) => {
          const callback =
            typeof args[args.length - 1] === 'function'
              ? (args.pop() as Callback)
              : null
          const run = check(args[0])

          if (!callback && style === 'promise') {
            return new Promise((resolve, reject) => {
              setTimeout(() => {
                try {
                  resolve(run())
                } catch (error) {
                  reject(error)
                }
              }, 1)
            })
          }

          setTimeout(() => answered(run, callback), 1)

          return undefined
        }
      ])
    ) as Record<keyof typeof methods, (...args: unknown[]) => unknown>

    return {scripting, runtime}
  }

  return {
    namespace,
    injections,
    unread,
    registered: () => registry.map(copy),
    ids: () => registry.map((script) => script.id)
  }
}

// Long enough for every step of a wrapped call to be answered.
export const answeredAll = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 60))

// The author's call in one of the two ways it can be written.
export function callIn(
  root: ReturnType<ReturnType<typeof fakeEngine>['namespace']>,
  method: keyof ReturnType<
    ReturnType<typeof fakeEngine>['namespace']
  >['scripting'],
  withCallback: boolean,
  ...args: unknown[]
) {
  const outcome: {
    returned?: unknown
    answers: unknown[][]
    errors: Array<string | null>
  } = {answers: [], errors: []}

  if (withCallback) {
    args.push((...values: unknown[]) => {
      outcome.errors.push(root.runtime.lastError?.message ?? null)
      outcome.answers.push(values)
    })
  }

  outcome.returned = root.scripting[method](...args)

  return outcome
}
