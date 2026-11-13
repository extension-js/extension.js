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

// A background whose registry answers after a set time, by callback when it
// is given one and by promise otherwise, the way the browser does.
function boot(options: {
  engine?: 'chromium' | 'firefox'
  registers?: boolean
  kept?: Registration[]
  answersAfter?: number
  refuses?: boolean
}) {
  const registered: Registration[] = [...(options.kept ?? [])]
  const runtime: {lastError: {message: string} | undefined} = {
    lastError: undefined
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
  const area = () => ({
    get: (_key: string, done: (res: Record<string, unknown>) => void) =>
      done({}),
    set: (_items: Record<string, unknown>, done?: () => void) => done?.(),
    remove: () => undefined
  })
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
    chrome: {
      runtime,
      scripting,
      storage: {local: area(), session: area()}
    },
    navigator: {userAgent: 'x'}
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

  return {ws, scripting, natives, registered, reports}
}

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
      await vi.advanceTimersByTimeAsync(1900)

      expect(h.reports()).toEqual([])

      await vi.advanceTimersByTimeAsync(400)

      expect(h.reports()).toEqual([
        {type: 'boot-registrations', calls: 1, landed: true}
      ])
    })
  }

  // A background that reads storage or waits on a timer first registers a
  // moment after its first line ran.
  it('waits for a registration made a second after the background started', async () => {
    const h = boot({})

    await vi.advanceTimersByTimeAsync(1200)

    expect(h.reports()).toEqual([])

    await h.scripting.registerContentScripts([HOOK])
    await vi.advanceTimersByTimeAsync(100)

    expect(h.reports()).toEqual([])

    await vi.advanceTimersByTimeAsync(150)

    expect(h.reports()).toHaveLength(1)
    expect(h.reports()[0].landed).toBe(true)
  })

  it('holds through an unregister that is followed by a register', async () => {
    const h = boot({answersAfter: 300})

    void (h.scripting.unregisterContentScripts() as Promise<unknown>).then(() =>
      h.scripting.registerContentScripts([HOOK])
    )

    await vi.advanceTimersByTimeAsync(500)

    expect(h.reports()).toEqual([])

    await vi.advanceTimersByTimeAsync(300)

    expect(h.reports()).toEqual([
      {type: 'boot-registrations', calls: 2, landed: true}
    ])
  })

  it('counts a call answered through a callback', async () => {
    const h = boot({answersAfter: 500})
    const done = vi.fn()

    h.scripting.registerContentScripts([HOOK], done)
    await vi.advanceTimersByTimeAsync(450)

    expect(h.reports()).toEqual([])

    await vi.advanceTimersByTimeAsync(250)

    expect(done).toHaveBeenCalledTimes(1)
    expect(h.reports()).toHaveLength(1)
  })

  // A registration a profile kept is on the first page whatever comes next.
  it('reports at once when the profile already holds a registration', async () => {
    const h = boot({kept: [HOOK]})

    await vi.advanceTimersByTimeAsync(250)

    expect(h.reports()).toEqual([
      {type: 'boot-registrations', calls: 0, landed: true}
    ])
  })

  it('does not take a dev registration of the build for one the author kept', async () => {
    const h = boot({kept: [{...HOOK, id: 'extjs-dev-cs-0'}]})

    await vi.advanceTimersByTimeAsync(1000)

    expect(h.reports()).toEqual([])
  })

  // The dev build puts the manifest's own scripts in the same registry.
  it('does not take a registration the dev build makes for the one awaited', async () => {
    const h = boot({})
    const own = [{...HOOK, id: 'extjs-dev-cs-0'}]

    await h.scripting.registerContentScripts(own)
    await h.scripting.updateContentScripts(own)
    await vi.advanceTimersByTimeAsync(1000)

    expect(h.reports()).toEqual([])

    await vi.advanceTimersByTimeAsync(600)

    expect(h.reports()).toEqual([
      {type: 'boot-registrations', calls: 0, landed: false}
    ])
  })

  // A background that registers only on a later event still gets a page.
  it('reports that nothing was registered once the background has been quiet', async () => {
    const h = boot({})

    await vi.advanceTimersByTimeAsync(1400)

    expect(h.reports()).toEqual([])

    await vi.advanceTimersByTimeAsync(200)

    expect(h.reports()).toEqual([
      {type: 'boot-registrations', calls: 0, landed: false}
    ])
  })

  it('does not count a registration the browser refused as landed', async () => {
    const h = boot({refuses: true})

    await (
      h.scripting.registerContentScripts([HOOK]) as Promise<unknown>
    ).catch(() => undefined)

    await vi.advanceTimersByTimeAsync(400)

    expect(h.reports()).toEqual([])

    await vi.advanceTimersByTimeAsync(1200)

    expect(h.reports()).toEqual([
      {type: 'boot-registrations', calls: 1, landed: false}
    ])
  })

  it('reports once, however long the background lives', async () => {
    const h = boot({})

    await h.scripting.registerContentScripts([HOOK])
    await vi.advanceTimersByTimeAsync(5000)
    await h.scripting.registerContentScripts([{...HOOK, id: 'later'}])
    await vi.advanceTimersByTimeAsync(5000)

    expect(h.reports()).toHaveLength(1)
  })

  it('gives up on a call the browser never answers', async () => {
    const h = boot({answersAfter: 60_000})

    void h.scripting.registerContentScripts([HOOK])
    await vi.advanceTimersByTimeAsync(14_000)

    expect(h.reports()).toEqual([])

    await vi.advanceTimersByTimeAsync(1500)

    expect(h.reports()).toEqual([
      {type: 'boot-registrations', calls: 1, landed: false}
    ])
  })

  it('throws a malformed call where the author made it', () => {
    const h = boot({})

    expect(() =>
      h.scripting.registerContentScripts('nope' as unknown as Registration[])
    ).toThrow(TypeError)
  })

  // A project whose background names no registration is left exactly as it
  // was: no wrapper on its registry and nothing said to the dev server.
  it('leaves the registry alone when the build named no registration', async () => {
    const h = boot({registers: false, engine: 'chromium'})

    await vi.advanceTimersByTimeAsync(20_000)

    expect(h.scripting.registerContentScripts).toBe(
      h.natives.registerContentScripts
    )

    expect(h.scripting.getRegisteredContentScripts).toBe(
      h.natives.getRegisteredContentScripts
    )

    expect(h.reports()).toEqual([])
  })
})
