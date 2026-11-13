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
  matches: string[]
  excludeMatches?: string[]
  world?: string
}

interface Tab {
  id: number
  url: string
}

// A background that called scripting.registerContentScripts itself: the
// browser read those files then, and only reads them again when told to.
function boot(options: {
  engine?: 'chromium' | 'firefox'
  registered: Registration[]
  tabs?: Tab[]
  stored?: Record<string, unknown>
}) {
  const calls: string[] = []
  const updates: unknown[] = []
  const reloadedTabs: number[] = []
  const stored: Record<string, unknown> = {...options.stored}
  const tabs = options.tabs ?? [{id: 7, url: 'http://probe.test/'}]
  const urlMatches = (pattern: string, url: string) =>
    pattern === '<all_urls>' || url.startsWith(pattern.replace(/\*$/, ''))
  const chrome = {
    runtime: {
      lastError: undefined,
      reload: () => calls.push('runtime.reload'),
      getManifest: () => ({})
    },
    scripting: {
      getRegisteredContentScripts: (cb: (list: Registration[]) => void) =>
        cb(options.registered),
      updateContentScripts: (list: unknown[], cb: () => void) => {
        calls.push('updateContentScripts')
        updates.push(...list)
        cb()
      }
    },
    tabs: {
      query: (q: {url?: string[]}, cb: (list: Tab[]) => void) =>
        cb(
          tabs.filter((tab) =>
            (q.url ?? []).some((pattern) => urlMatches(pattern, tab.url))
          )
        ),
      reload: (id: number) => {
        calls.push(`tabs.reload ${id}`)
        reloadedTabs.push(id)
      }
    },
    storage: {
      local: {
        get: (key: string, cb: (res: Record<string, unknown>) => void) =>
          cb(key in stored ? {[key]: stored[key]} : {}),
        set: (items: Record<string, unknown>, cb?: () => void) => {
          Object.assign(stored, items)
          cb?.()
        },
        remove: (key: string) => {
          delete stored[key]
        }
      }
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

  // The runtime names the engine from the scheme of its own address.
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
      instanceId: 'inst-R',
      context: 'background'
    })
  )(fakeGlobal)

  const ws = FakeWebSocket.instances[0]
  ws.onopen?.()

  return {ws, calls, updates, reloadedTabs, stored}
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
  label: 'page (scripts/logo.png)',
  changedFiles: ['scripts/logo.png'],
  changedScriptFiles
})

describe('bridge producer runtime, scripts the background registered itself', () => {
  beforeEach(() => {
    vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  // Chromium kept serving the bytes it read at registration, a tab reload
  // included, until the registration was updated.
  it('updates the registration that names a changed file, then reloads its tabs', async () => {
    const h = boot({registered: [HOOK]})

    h.ws.triggerMessage(pageFrame(['scripts/hook.js']))
    await vi.advanceTimersByTimeAsync(0)

    expect(h.updates).toEqual([{id: 'hook', js: ['scripts/hook.js']}])
    expect(h.calls).toEqual(['updateContentScripts', 'tabs.reload 7'])
  })

  it('reloads no tab an excludeMatches pattern covers', async () => {
    const h = boot({
      registered: [{...HOOK, excludeMatches: ['http://probe.test/admin/*']}],
      tabs: [
        {id: 7, url: 'http://probe.test/'},
        {id: 8, url: 'http://probe.test/admin/users'}
      ]
    })

    h.ws.triggerMessage(pageFrame(['scripts/hook.js']))
    await vi.advanceTimersByTimeAsync(0)

    expect(h.reloadedTabs).toEqual([7])
  })

  it('leaves alone a registration that names no changed file, and the dev ones', async () => {
    const h = boot({
      registered: [
        {...HOOK, id: 'other', js: ['scripts/other.js']},
        {...HOOK, id: 'extjs-dev-cs-0'}
      ]
    })

    h.ws.triggerMessage(pageFrame(['scripts/hook.js']))
    await vi.advanceTimersByTimeAsync(1000)

    expect(h.calls).toEqual([])
  })

  it('matches a registered stylesheet and a leading slash too', async () => {
    const h = boot({
      registered: [
        {id: 'theme', css: ['/scripts/theme.css'], matches: ['<all_urls>']}
      ]
    })

    h.ws.triggerMessage(pageFrame(['scripts/theme.css']))
    await vi.advanceTimersByTimeAsync(0)

    expect(h.updates).toEqual([{id: 'theme', css: ['/scripts/theme.css']}])
    expect(h.reloadedTabs).toEqual([7])
  })

  // Gecko keeps a registered file by address through an update and a tab
  // reload. With no session storage to hold a new address, it restarts.
  it('restarts the extension on Gecko without session storage and records the tabs for the next generation', async () => {
    const h = boot({engine: 'firefox', registered: [HOOK]})

    h.ws.triggerMessage(pageFrame(['scripts/hook.js']))
    await vi.advanceTimersByTimeAsync(0)

    expect(h.calls).toEqual([])
    expect(h.stored.__extjsDevRegisteredReload).toMatchObject({
      tabs: [7],
      scripts: ['hook']
    })

    await vi.advanceTimersByTimeAsync(200)

    expect(h.calls).toEqual(['runtime.reload'])
  })

  it('reloads the recorded tabs once the next generation has its registrations', async () => {
    const registered: Registration[] = []
    const h = boot({
      engine: 'firefox',
      registered,
      stored: {
        __extjsDevRegisteredReload: {
          at: Date.now(),
          tabs: [7],
          scripts: ['hook']
        }
      }
    })

    await vi.advanceTimersByTimeAsync(600)
    expect(h.reloadedTabs).toEqual([])

    registered.push(HOOK)
    await vi.advanceTimersByTimeAsync(600)

    expect(h.reloadedTabs).toEqual([7])
    expect(h.stored.__extjsDevRegisteredReload).toBeUndefined()
  })

  // A registration that outlived the restart is dropped and made again by a
  // background that unregisters first, and a tab reloaded in between misses it.
  it('waits out a background that unregisters before it registers again', async () => {
    const registered: Registration[] = [HOOK]
    const h = boot({
      engine: 'firefox',
      registered,
      stored: {
        __extjsDevRegisteredReload: {
          at: Date.now(),
          tabs: [7],
          scripts: ['hook']
        }
      }
    })

    await vi.advanceTimersByTimeAsync(300)
    registered.length = 0
    await vi.advanceTimersByTimeAsync(300)
    registered.push(HOOK)

    expect(h.reloadedTabs).toEqual([])

    await vi.advanceTimersByTimeAsync(600)

    expect(h.reloadedTabs).toEqual([7])
  })

  it('ignores a record older than the restart it was written for', async () => {
    const h = boot({
      engine: 'firefox',
      registered: [HOOK],
      stored: {
        __extjsDevRegisteredReload: {
          at: Date.now() - 60000,
          tabs: [7],
          scripts: ['hook']
        }
      }
    })

    await vi.advanceTimersByTimeAsync(6000)

    expect(h.reloadedTabs).toEqual([])
  })
})
