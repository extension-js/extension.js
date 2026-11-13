import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {buildBridgeProducerSource} from '../producer-runtime'

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
  triggerMessage(obj: unknown) {
    this.onmessage?.({data: JSON.stringify(obj)})
  }
}

interface Registration {
  id: string
  js?: string[]
  css?: string[]
  matches?: string[]
  world?: string
}

type Callback = (value?: unknown) => void

const ADDRESS = '?extjs-dev='

// A Gecko background with session storage, whose scripting calls answer a
// callback when given one and a promise otherwise, the way the browser does.
function boot(options: {
  engine?: 'chromium' | 'firefox'
  registered?: Registration[]
  session?: Record<string, unknown>
  refuseUpdate?: boolean
  withoutSession?: boolean
  tabsAnswerAfter?: number
}) {
  const calls: string[] = []
  const reloadedTabs: number[] = []
  const copyOf = (script: Registration): Registration =>
    JSON.parse(JSON.stringify(script))
  const registered: Registration[] = (options.registered ?? []).map(copyOf)
  const session: Record<string, unknown> = {...options.session}
  const local: Record<string, unknown> = {}
  const runtime: {
    lastError: {message: string} | undefined
    reload(): void
    getManifest(): object
  } = {
    lastError: undefined,
    reload: () => calls.push('runtime.reload'),
    getManifest: () => ({})
  }

  const answer = (done: Callback | undefined, value?: unknown) => {
    if (done) {
      done(value)

      return undefined
    }

    return Promise.resolve(value)
  }

  const area = (data: Record<string, unknown>) => ({
    get: (key: string, done: (res: Record<string, unknown>) => void) =>
      done(key in data ? {[key]: data[key]} : {}),
    set: (items: Record<string, unknown>, done?: () => void) => {
      Object.assign(data, JSON.parse(JSON.stringify(items)))
      done?.()
    },
    remove: (key: string) => {
      delete data[key]
    }
  })
  const scripting = {
    registerContentScripts: (list: Registration[], done?: Callback) => {
      calls.push('registerContentScripts')
      registered.push(...list.map(copyOf))

      return answer(done)
    },
    updateContentScripts: (list: Registration[], done?: Callback) => {
      calls.push('updateContentScripts')

      if (options.refuseUpdate) {
        runtime.lastError = {message: 'refused'}
        const out = answer(done)
        runtime.lastError = undefined

        return out
      }

      for (const update of list) {
        const known = registered.find((script) => script.id === update.id)
        if (known) Object.assign(known, copyOf(update))
      }

      return answer(done)
    },
    unregisterContentScripts: (
      filter?: {ids?: string[]} | Callback,
      done?: Callback
    ) => {
      calls.push('unregisterContentScripts')
      const ids = typeof filter === 'object' ? filter.ids : undefined

      for (let i = registered.length - 1; i >= 0; i--) {
        if (!ids || ids.includes(registered[i].id)) registered.splice(i, 1)
      }

      return answer(typeof filter === 'function' ? filter : done)
    },
    getRegisteredContentScripts: (
      filter?: {ids?: string[]} | Callback,
      done?: Callback
    ) =>
      answer(
        typeof filter === 'function' ? filter : done,
        registered.map(copyOf)
      )
  }
  const chrome = {
    runtime,
    scripting,
    tabs: {
      query: (
        _query: object,
        done: (list: {id: number; url: string}[]) => void
      ) => {
        const tabs = [{id: 7, url: 'http://probe.test/'}]

        if (!options.tabsAnswerAfter) return done(tabs)

        setTimeout(() => done(tabs), options.tabsAnswerAfter)
      },
      reload: (id: number) => {
        calls.push(`tabs.reload ${id}`)
        reloadedTabs.push(id)
      }
    },
    storage: {
      local: area(local),
      ...(options.withoutSession ? {} : {session: area(session)})
    }
  }
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
    chrome,
    navigator: {userAgent: 'x'}
  }

  vi.stubGlobal('location', {
    protocol:
      options.engine === 'chromium' ? 'chrome-extension:' : 'moz-extension:'
  })

  const natives = {...scripting}

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

  return {
    ws,
    calls,
    reloadedTabs,
    registered,
    session,
    local,
    natives,
    scripting
  }
}

const HOOK: Registration = {
  id: 'hook',
  js: ['scripts/hook.js'],
  matches: ['http://probe.test/*'],
  world: 'MAIN'
}

const pageFrame = (changedScriptFiles: string[]) => ({
  type: 'reload',
  reloadType: 'page',
  label: 'page (scripts/hook.js)',
  changedFiles: ['scripts/hook.js'],
  changedScriptFiles
})

const addressOf = (script: Registration | undefined) => script?.js?.[0] ?? ''

describe('bridge producer runtime, the address of a registered script on Gecko', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  // Gecko ran the copy it read first at an address through an update and a
  // tab reload. A registration at a new address reads the file again.
  it('moves the registration to a new address and reloads its tabs, without a restart', async () => {
    const h = boot({registered: [HOOK]})

    h.ws.triggerMessage(pageFrame(['scripts/hook.js']))
    await vi.advanceTimersByTimeAsync(2000)

    expect(addressOf(h.registered[0])).toContain(`scripts/hook.js${ADDRESS}`)
    expect(h.calls).toEqual(['updateContentScripts', 'tabs.reload 7'])
    expect(h.local.__extjsDevRegisteredReload).toBeUndefined()
  })

  it('gives each edit its own address', async () => {
    const h = boot({registered: [HOOK]})

    h.ws.triggerMessage(pageFrame(['scripts/hook.js']))
    await vi.advanceTimersByTimeAsync(2000)
    const first = addressOf(h.registered[0])

    h.ws.triggerMessage(pageFrame(['scripts/hook.js']))
    await vi.advanceTimersByTimeAsync(2000)
    const second = addressOf(h.registered[0])

    expect(second).toContain(`scripts/hook.js${ADDRESS}`)
    expect(second).not.toBe(first)
    expect(second.split(ADDRESS)).toHaveLength(2)
    expect(h.reloadedTabs).toEqual([7, 7])
  })

  // A background the edit woke runs its own top level again. One that
  // unregisters before it registers has no registration for a moment.
  it('waits out a background that is between its unregister and register calls', async () => {
    const h = boot({registered: [HOOK]})

    const background = (async () => {
      await h.scripting.unregisterContentScripts({ids: ['hook']})
      await new Promise((resolve) => setTimeout(resolve, 200))
      await h.scripting.registerContentScripts([HOOK])
    })()

    await vi.advanceTimersByTimeAsync(50)
    expect(h.registered).toEqual([])

    h.ws.triggerMessage(pageFrame(['scripts/hook.js']))
    await vi.advanceTimersByTimeAsync(3000)
    await background

    expect(addressOf(h.registered[0])).toContain(`scripts/hook.js${ADDRESS}`)
    expect(h.reloadedTabs).toEqual([7])
    expect(h.calls).not.toContain('runtime.reload')
  })

  // The plain address still holds the first copy the browser read, so a
  // background that registers the file again must not go back to it.
  it('registers a changed file at its current address when the background names it again', async () => {
    const h = boot({registered: [HOOK]})

    h.ws.triggerMessage(pageFrame(['scripts/hook.js']))
    await vi.advanceTimersByTimeAsync(2000)
    const moved = addressOf(h.registered[0])

    await h.scripting.unregisterContentScripts({ids: ['hook']})
    await h.scripting.registerContentScripts([
      HOOK,
      {...HOOK, id: 'other', js: ['scripts/other.js']}
    ])

    expect(moved).toContain(ADDRESS)
    expect(addressOf(h.registered[0])).toBe(moved)
    expect(addressOf(h.registered[1])).toBe('scripts/other.js')
  })

  it('gives the background the names it wrote, by promise and by callback', async () => {
    const h = boot({registered: [HOOK]})

    h.ws.triggerMessage(pageFrame(['scripts/hook.js']))
    await vi.advanceTimersByTimeAsync(2000)

    const promised = (await h.scripting.getRegisteredContentScripts()) as
      | Registration[]
      | undefined
    let called: Registration[] | undefined

    h.scripting.getRegisteredContentScripts((list) => {
      called = list as Registration[]
    })

    expect(promised?.[0].js).toEqual(['scripts/hook.js'])
    expect(called?.[0].js).toEqual(['scripts/hook.js'])
    expect(addressOf(h.registered[0])).not.toBe('scripts/hook.js')
  })

  // The addresses live in session storage, which a suspended background
  // keeps and an extension reload empties.
  it('keeps the addresses for a background that was suspended and started again', async () => {
    const first = boot({registered: [HOOK]})

    first.ws.triggerMessage(pageFrame(['scripts/hook.js']))
    await vi.advanceTimersByTimeAsync(2000)
    const moved = addressOf(first.registered[0])

    const woken = boot({session: first.session})

    await woken.scripting.registerContentScripts([HOOK])

    expect(moved).toContain(ADDRESS)
    expect(addressOf(woken.registered[0])).toBe(moved)
  })

  // The changed file is already at its new address by the time the browser
  // answers, so giving up there would leave the tab on the copy it had.
  it('still moves the registration and reloads its tabs when the browser answers late', async () => {
    const h = boot({registered: [HOOK], tabsAnswerAfter: 2500})

    h.ws.triggerMessage(pageFrame(['scripts/hook.js']))
    await vi.advanceTimersByTimeAsync(5000)

    expect(addressOf(h.registered[0])).toContain(`scripts/hook.js${ADDRESS}`)
    expect(h.reloadedTabs).toEqual([7])
    expect(h.calls).not.toContain('runtime.reload')
  })

  it('leaves a name that carries its own query alone', async () => {
    const h = boot({
      registered: [{...HOOK, js: ['scripts/hook.js?mine=1']}]
    })

    h.ws.triggerMessage(pageFrame(['scripts/hook.js']))
    await vi.advanceTimersByTimeAsync(2000)

    expect(addressOf(h.registered[0])).toBe('scripts/hook.js?mine=1')
  })

  it('restarts the extension when the browser refuses the new address', async () => {
    const h = boot({registered: [HOOK], refuseUpdate: true})

    h.ws.triggerMessage(pageFrame(['scripts/hook.js']))
    await vi.advanceTimersByTimeAsync(2000)

    expect(h.local.__extjsDevRegisteredReload).toMatchObject({
      tabs: [7],
      scripts: ['hook']
    })

    expect(h.calls).toContain('runtime.reload')
    expect(h.reloadedTabs).toEqual([])
  })

  it('restarts the extension when no session storage can hold the addresses', async () => {
    const h = boot({registered: [HOOK], withoutSession: true})

    h.ws.triggerMessage(pageFrame(['scripts/hook.js']))
    await vi.advanceTimersByTimeAsync(2000)

    expect(h.calls).toEqual(['runtime.reload'])
    expect(h.scripting.registerContentScripts).toBe(
      h.natives.registerContentScripts
    )
  })

  // Chromium reads a registered file again on an update at the same name.
  it('leaves the scripting calls of a Chromium background as the browser made them', async () => {
    const h = boot({engine: 'chromium', registered: [HOOK]})

    expect(h.scripting.registerContentScripts).toBe(
      h.natives.registerContentScripts
    )

    expect(h.scripting.getRegisteredContentScripts).toBe(
      h.natives.getRegisteredContentScripts
    )

    h.ws.triggerMessage(pageFrame(['scripts/hook.js']))
    await vi.advanceTimersByTimeAsync(2000)

    expect(addressOf(h.registered[0])).toBe('scripts/hook.js')
    expect(h.calls).toEqual(['updateContentScripts', 'tabs.reload 7'])
  })
})
