import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {
  buildBridgeProducerSource,
  DEV_BOOT_REGISTERS_GLOBAL
} from '../producer-runtime'

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  sent: string[] = []
  onopen: (() => void) | null = null
  onmessage: ((ev: {data: string}) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(public url: string) {
    FakeWebSocket.instances.push(this)
  }
  send(data: string) {
    this.sent.push(data)
  }
  close() {
    this.onclose?.()
  }
}

interface Registration {
  id: string
  js?: string[]
  matches?: string[]
}

type Callback = (value?: unknown) => void

const HOOK: Registration = {
  id: 'hook',
  js: ['scripts/hook.js'],
  matches: ['http://probe.test/*']
}

// A background whose calls answer after a set time, by callback when one is
// given and by promise otherwise, the way the browser does.
function boot(
  options: {
    engine?: 'chromium' | 'firefox'
    registers?: boolean
    kept?: Registration[]
    answersAfter?: number
    refuses?: boolean
    // A service worker that is installing, or one the browser only woke.
    worker?: 'installing' | 'woken'
    // A background page, which loads before its install event.
    page?: boolean
  } = {}
) {
  const registered: Registration[] = [...(options.kept ?? [])]
  const runtime: {
    lastError: {message: string} | undefined
    onInstalled?: {addListener: (fn: () => void) => void}
  } = {lastError: undefined}
  const listeners: Record<string, Array<() => void>> = {}

  const on = (name: string, fn: () => void) => {
    ;(listeners[name] ??= []).push(fn)
  }

  const fire = (name: string) => {
    for (const fn of listeners[name] ?? []) fn()
  }

  const answer = (done: Callback | undefined, value: unknown, fails = false) =>
    new Promise<unknown>((resolve, reject) => {
      const settle = () => {
        if (done) {
          if (fails) runtime.lastError = {message: 'refused'}

          done(value)
          runtime.lastError = undefined
          resolve(undefined)
        } else if (fails) {
          reject(new Error('refused'))
        } else {
          resolve(value)
        }
      }

      if (options.answersAfter) setTimeout(settle, options.answersAfter)
      else queueMicrotask(settle)
    })

  const scripting = {
    registerContentScripts: (list: Registration[], done?: Callback) => {
      if (!Array.isArray(list)) throw new TypeError('shape')
      if (!options.refuses) registered.push(...list)

      const out = answer(done, undefined, options.refuses)

      return done ? undefined : out
    },
    updateContentScripts: (_list: Registration[], done?: Callback) => {
      const out = answer(done, undefined)

      return done ? undefined : out
    },
    unregisterContentScripts: (done?: Callback) => {
      registered.length = 0
      const out = answer(
        typeof done === 'function' ? done : undefined,
        undefined
      )

      return typeof done === 'function' ? undefined : out
    },
    getRegisteredContentScripts: (done?: Callback) => {
      const out = answer(typeof done === 'function' ? done : undefined, [
        ...registered
      ])

      return typeof done === 'function' ? undefined : out
    }
  }
  const natives = {...scripting}
  // The bridge reads storage with a callback. An author awaits the promise.
  const area = () => ({
    get: (_key: string, done?: (res: Record<string, unknown>) => void) =>
      done ? done({}) : answer(undefined, {}),
    set: (_items: Record<string, unknown>, done?: () => void) => done?.(),
    remove: () => undefined
  })
  const storage = {local: area(), session: area()}
  const nativeGet = storage.local.get
  const nativeFetch = () => answer(undefined, {ok: true})
  const fakeGlobal: Record<string, unknown> = {
    WebSocket: FakeWebSocket,
    console: {
      log() {},
      info() {},
      warn() {},
      error() {},
      debug() {},
      trace() {}
    },
    chrome: {runtime, scripting, storage},
    fetch: nativeFetch,
    navigator: {userAgent: 'x'}
  }

  if (options.worker) {
    fakeGlobal.serviceWorker = {
      state: options.worker === 'woken' ? 'activated' : 'parsed'
    }

    fakeGlobal.addEventListener = on
  }

  if (options.page) {
    runtime.onInstalled = {addListener: (fn) => on('installed', fn)}
    fakeGlobal.document = {readyState: 'loading'}
    fakeGlobal.addEventListener = on
  }

  if (options.registers !== false) fakeGlobal[DEV_BOOT_REGISTERS_GLOBAL] = true

  vi.stubGlobal('location', {
    protocol:
      options.engine === 'firefox' ? 'moz-extension:' : 'chrome-extension:'
  })

  FakeWebSocket.instances = []
  // eslint-disable-next-line no-new-func
  new Function(
    'globalThis',
    buildBridgeProducerSource({
      controlPort: 9999,
      instanceId: 'inst-A',
      context: 'background'
    })
  )(fakeGlobal)

  const ws = FakeWebSocket.instances[0]
  ws.onopen?.()

  const reports = () =>
    ws.sent
      .map((text) => JSON.parse(text) as {type: string; [k: string]: unknown})
      .filter((frame) => frame.type === 'boot-registrations')

  return {
    ws,
    scripting,
    natives,
    storage,
    nativeGet,
    nativeFetch,
    registered,
    reports,
    fire,
    fetch: () => (fakeGlobal.fetch as () => Promise<unknown>)(),
    global: fakeGlobal
  }
}

const SETTLED = {type: 'boot-registrations', calls: 1, landed: true}
const NOTHING = {type: 'boot-registrations', calls: 0, landed: false}

describe('bridge producer runtime, the registrations a background makes as it starts', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  for (const engine of ['chromium', 'firefox'] as const) {
    // The first page waits on this report, so it must not come while the
    // browser still holds the call that puts the script on that page.
    it(`reports only after a registration the browser answers late has landed (${engine})`, async () => {
      const h = boot({engine, answersAfter: 2000})

      void h.scripting.registerContentScripts([HOOK])
      await vi.advanceTimersByTimeAsync(1950)

      expect(h.reports()).toEqual([])

      await vi.advanceTimersByTimeAsync(150)

      expect(h.reports()).toEqual([SETTLED])
    })
  }

  // The cost a background pays for naming a registration it makes only on a
  // later event: the browser's install events, then two looks at nothing.
  it('reports a background that calls nothing as soon as its install events are over', async () => {
    const h = boot({worker: 'installing'})

    await vi.advanceTimersByTimeAsync(5)
    h.fire('activate')
    await vi.advanceTimersByTimeAsync(20)

    expect(h.reports()).toEqual([])

    await vi.advanceTimersByTimeAsync(60)

    expect(h.reports()).toEqual([NOTHING])
  })

  it('does not wait on install events for a worker the browser only woke', async () => {
    const h = boot({worker: 'woken'})

    await vi.advanceTimersByTimeAsync(80)

    expect(h.reports()).toEqual([NOTHING])
  })

  it('stops waiting on a worker that never says it activated', async () => {
    const h = boot({worker: 'installing'})

    await vi.advanceTimersByTimeAsync(950)

    expect(h.reports()).toEqual([])

    await vi.advanceTimersByTimeAsync(150)

    expect(h.reports()).toEqual([NOTHING])
  })

  it('holds for a registration made in the install listener of a worker', async () => {
    const h = boot({worker: 'installing', answersAfter: 400})

    await vi.advanceTimersByTimeAsync(3)
    void h.scripting.registerContentScripts([HOOK])
    h.fire('activate')
    await vi.advanceTimersByTimeAsync(380)

    expect(h.reports()).toEqual([])

    await vi.advanceTimersByTimeAsync(100)

    expect(h.reports()).toEqual([SETTLED])
  })

  // A background page gets its install event a moment after it loaded.
  it('holds for a registration made in the install listener of a page', async () => {
    const h = boot({page: true, engine: 'firefox', answersAfter: 400})

    await vi.advanceTimersByTimeAsync(120)
    h.fire('load')
    await vi.advanceTimersByTimeAsync(3)
    h.fire('installed')
    void h.scripting.registerContentScripts([HOOK])
    await vi.advanceTimersByTimeAsync(380)

    expect(h.reports()).toEqual([])

    await vi.advanceTimersByTimeAsync(100)

    expect(h.reports()).toEqual([SETTLED])
  })

  it('gives a page that gets no install event a moment after it loaded', async () => {
    const h = boot({page: true, engine: 'firefox'})

    await vi.advanceTimersByTimeAsync(100)
    h.fire('load')
    await vi.advanceTimersByTimeAsync(240)

    expect(h.reports()).toEqual([])

    await vi.advanceTimersByTimeAsync(80)

    expect(h.reports()).toEqual([NOTHING])
  })

  // The registration follows a read the background awaits, and nothing is
  // in the registry while the browser still holds that read.
  it('holds through a storage read the registration comes after', async () => {
    const h = boot({worker: 'woken', answersAfter: 700})

    void (h.storage.local.get('settings') as Promise<unknown>).then(() =>
      h.scripting.registerContentScripts([HOOK])
    )

    await vi.advanceTimersByTimeAsync(1350)

    expect(h.reports()).toEqual([])

    await vi.advanceTimersByTimeAsync(150)

    expect(h.reports()).toEqual([SETTLED])
  })

  it('holds through a fetch the registration comes after', async () => {
    const h = boot({worker: 'woken', answersAfter: 700})

    void h.fetch().then(() => h.scripting.registerContentScripts([HOOK]))

    await vi.advanceTimersByTimeAsync(1350)

    expect(h.reports()).toEqual([])

    await vi.advanceTimersByTimeAsync(150)

    expect(h.reports()).toEqual([SETTLED])
  })

  it('holds through an unregister that is followed by a register', async () => {
    const h = boot({worker: 'woken', answersAfter: 300})

    void (h.scripting.unregisterContentScripts() as Promise<unknown>).then(() =>
      h.scripting.registerContentScripts([HOOK])
    )

    await vi.advanceTimersByTimeAsync(580)

    expect(h.reports()).toEqual([])

    await vi.advanceTimersByTimeAsync(100)

    expect(h.reports()).toEqual([
      {type: 'boot-registrations', calls: 2, landed: true}
    ])
  })

  it('counts a call answered through a callback', async () => {
    const h = boot({worker: 'woken', answersAfter: 500})
    const done = vi.fn()

    h.scripting.registerContentScripts([HOOK], done)
    await vi.advanceTimersByTimeAsync(480)

    expect(h.reports()).toEqual([])

    await vi.advanceTimersByTimeAsync(100)

    expect(done).toHaveBeenCalledTimes(1)
    expect(h.reports()).toEqual([SETTLED])
  })

  // A registration a profile kept is on the first page whatever comes next.
  it('says a registration the profile already holds has landed', async () => {
    const h = boot({worker: 'woken', kept: [HOOK]})

    await vi.advanceTimersByTimeAsync(80)

    expect(h.reports()).toEqual([
      {type: 'boot-registrations', calls: 0, landed: true}
    ])
  })

  // The dev build puts the manifest's own scripts in the same registry.
  it('does not take a registration of the dev build for one the author made', async () => {
    const own = [{...HOOK, id: 'extjs-dev-cs-0'}]
    const h = boot({worker: 'woken', kept: own, answersAfter: 300})

    void h.scripting.registerContentScripts(own)
    void h.scripting.updateContentScripts(own)
    await vi.advanceTimersByTimeAsync(400)

    expect(h.reports()).toEqual([NOTHING])
  })

  it('does not count a registration the browser refused as landed', async () => {
    const h = boot({worker: 'woken', refuses: true})

    await expect(h.scripting.registerContentScripts([HOOK])).rejects.toThrow(
      'refused'
    )

    await vi.advanceTimersByTimeAsync(80)

    expect(h.reports()).toEqual([
      {type: 'boot-registrations', calls: 1, landed: false}
    ])
  })

  // A timer is not a call the browser answers, so the registration behind
  // one is seen only when it is made, and the author is told it came late.
  it('says once that a registration landed after it reported none', async () => {
    const h = boot({worker: 'woken'})

    await vi.advanceTimersByTimeAsync(1200)

    expect(h.reports()).toEqual([NOTHING])

    await h.scripting.registerContentScripts([HOOK])
    await h.scripting.registerContentScripts([{...HOOK, id: 'second'}])
    await vi.advanceTimersByTimeAsync(1000)

    expect(h.reports()).toEqual([
      NOTHING,
      {type: 'boot-registrations', late: true, afterMs: 1200}
    ])
  })

  // By then the registration answers something the author did, not a start.
  it('says nothing about a registration made long after the start', async () => {
    const h = boot({worker: 'woken'})

    await vi.advanceTimersByTimeAsync(15_100)
    await h.scripting.registerContentScripts([HOOK])
    await vi.advanceTimersByTimeAsync(1000)

    expect(h.reports()).toEqual([NOTHING])
  })

  it('gives up on a call the browser never answers, and says so', async () => {
    const h = boot({worker: 'woken', answersAfter: 60_000})

    void h.scripting.registerContentScripts([HOOK])
    await vi.advanceTimersByTimeAsync(3950)

    expect(h.reports()).toEqual([])

    await vi.advanceTimersByTimeAsync(100)

    expect(h.reports()).toEqual([
      {type: 'boot-registrations', calls: 1, landed: false, pending: true}
    ])
  })

  // The background runs on the browser's own functions once it reported.
  it('hands back every call it counted except the registry', async () => {
    const h = boot({worker: 'woken'})

    expect(h.storage.local.get).not.toBe(h.nativeGet)
    expect(h.global.fetch).not.toBe(h.nativeFetch)

    await vi.advanceTimersByTimeAsync(80)

    expect(h.reports()).toEqual([NOTHING])
    expect(h.storage.local.get).toBe(h.nativeGet)
    expect(h.global.fetch).toBe(h.nativeFetch)
  })

  it('throws a malformed call where the author made it', () => {
    const h = boot()

    expect(() =>
      h.scripting.registerContentScripts('nope' as unknown as Registration[])
    ).toThrow(TypeError)
  })

  // A project whose background names no registration is left exactly as it
  // was: no wrapper on its calls and nothing said to the dev server.
  it('leaves every call alone when the build named no registration', async () => {
    const h = boot({registers: false, engine: 'chromium', worker: 'installing'})

    await vi.advanceTimersByTimeAsync(20_000)

    expect(h.scripting.registerContentScripts).toBe(
      h.natives.registerContentScripts
    )

    expect(h.scripting.getRegisteredContentScripts).toBe(
      h.natives.getRegisteredContentScripts
    )

    expect(h.storage.local.get).toBe(h.nativeGet)
    expect(h.global.fetch).toBe(h.nativeFetch)
    expect(h.reports()).toEqual([])
  })
})
