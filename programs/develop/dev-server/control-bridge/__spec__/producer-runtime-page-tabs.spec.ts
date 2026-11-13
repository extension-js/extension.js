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

interface Tab {
  id: number
  url?: string
  windowId?: number
  index?: number
  active?: boolean
  pinned?: boolean
}

const BASE = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/'
const PAGE_TABS = '__extjsDevPageTabs'
const LOOSE = `${BASE}loose/index.html`

function boot(options: {
  tabs?: Tab[]
  local?: Record<string, unknown>
  build?: string
  createFails?: boolean
  noTabs?: boolean
}) {
  const calls: string[] = []
  const created: Array<Record<string, unknown>> = []
  const local: Record<string, unknown> = {...options.local}
  const tabs = options.tabs ?? []
  const runtime: {lastError: unknown; [key: string]: unknown} = {
    lastError: undefined,
    reload: () => calls.push('runtime.reload'),
    getURL: (file: string) => `${BASE}${file}`,
    getManifest: () => ({}),
    onMessage: {addListener: () => {}}
  }

  const chrome = {
    runtime,
    ...(options.noTabs
      ? {}
      : {
          tabs: {
            query: (_q: unknown, cb: (list: Tab[]) => void) => cb(tabs),
            reload: (id: number, props?: {bypassCache?: boolean}) =>
              calls.push(
                `tabs.reload ${id}${props?.bypassCache ? ' fresh' : ''}`
              ),
            // Chromium refuses a window that closed with its last tab.
            create: (props: Record<string, unknown>, cb?: () => void) => {
              created.push(props)

              if (options.createFails && 'windowId' in props) {
                runtime.lastError = {message: 'No window with id: 3.'}
              }

              cb?.()
              runtime.lastError = undefined
            }
          }
        }),
    storage: {
      local: {
        get: (key: string, cb: (res: Record<string, unknown>) => void) =>
          cb(key in local ? {[key]: local[key]} : {}),
        set: (items: Record<string, unknown>, cb?: () => void) => {
          Object.assign(local, items)
          cb?.()
        },
        remove: (key: string, cb?: () => void) => {
          delete local[key]
          cb?.()
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
    navigator: {userAgent: 'x'},
    ...(options.build === undefined ? {} : {__extjsDevBuild: options.build})
  }

  vi.stubGlobal('location', {protocol: 'chrome-extension:'})

  FakeWebSocket.instances = []
  // eslint-disable-next-line no-new-func
  new Function(
    'globalThis',
    buildBridgeProducerSource({
      controlPort: 9999,
      instanceId: 'inst-P',
      context: 'background'
    })
  )(fakeGlobal)

  const ws = FakeWebSocket.instances[0]
  ws.onopen?.()

  return {ws, calls, created, local}
}

const recorded = (tabs: unknown[], at = Date.now()) => ({
  [PAGE_TABS]: {at, tabs}
})

describe('bridge producer runtime, the extension’s own page tabs across a reload', () => {
  beforeEach(() => {
    vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'Date']})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  // Chromium closes these tabs on the reload and Gecko keeps them on the old
  // document, so what was open has to be written down before either happens.
  it('records the open page tabs of the extension before it restarts', async () => {
    const h = boot({
      tabs: [
        {id: 1, url: 'https://a.test/'},
        {
          id: 2,
          url: `${LOOSE}?tab=1#top`,
          windowId: 3,
          index: 4,
          active: true,
          pinned: false
        },
        {id: 5, url: 'chrome-extension://someoneelse/loose/index.html'},
        {id: 6}
      ]
    })

    h.ws.triggerMessage({
      type: 'reload',
      reloadType: 'full',
      label: 'extension (loose/page.js)'
    })

    await vi.advanceTimersByTimeAsync(2000)

    expect(h.local[PAGE_TABS]).toMatchObject({
      tabs: [
        {
          tabId: 2,
          url: `${LOOSE}?tab=1#top`,
          windowId: 3,
          index: 4,
          active: true,
          pinned: false
        }
      ]
    })

    expect(h.calls).toContain('runtime.reload')
  })

  it('reloads a recorded tab the browser kept, past its cache', async () => {
    const h = boot({
      tabs: [{id: 2, url: LOOSE}],
      local: recorded([{tabId: 2, url: LOOSE, windowId: 3, index: 0}])
    })

    expect(h.local[PAGE_TABS]).toBeUndefined()
    await vi.advanceTimersByTimeAsync(499)
    expect(h.calls).toEqual([])
    await vi.advanceTimersByTimeAsync(1)

    expect(h.calls).toEqual(['tabs.reload 2 fresh'])
    expect(h.created).toEqual([])
  })

  it('opens a recorded tab the browser closed where it was, once per address', async () => {
    const h = boot({
      tabs: [{id: 1, url: 'https://a.test/'}],
      local: recorded([
        {
          tabId: 2,
          url: LOOSE,
          windowId: 3,
          index: 4,
          active: true,
          pinned: true
        },
        {tabId: 7, url: LOOSE, windowId: 3, index: 5}
      ])
    })

    await vi.advanceTimersByTimeAsync(500)

    expect(h.created).toEqual([
      {url: LOOSE, windowId: 3, index: 4, active: true, pinned: true}
    ])

    expect(h.calls).toEqual([])
  })

  it('opens it in any window when its own window went with it', async () => {
    const h = boot({
      createFails: true,
      local: recorded([{tabId: 2, url: LOOSE, windowId: 3, index: 0}])
    })

    await vi.advanceTimersByTimeAsync(500)

    expect(h.created).toEqual([
      {url: LOOSE, windowId: 3, index: 0, active: false, pinned: false},
      {url: LOOSE, active: false}
    ])
  })

  // The extension may open its page itself when it starts, and a tab that
  // moved on since the reload is no longer the one that was recorded.
  it('leaves alone a page the extension already opened again, and a tab that navigated away', async () => {
    const other = `${BASE}pages/extra.html`
    const h = boot({
      tabs: [
        {id: 9, url: LOOSE},
        {id: 4, url: 'https://a.test/'}
      ],
      local: recorded([
        {tabId: 2, url: LOOSE},
        {tabId: 4, url: other}
      ])
    })

    await vi.advanceTimersByTimeAsync(500)

    expect([h.calls, h.created]).toEqual([[], []])
  })

  it('restores nothing from a record that is old, malformed or names a foreign address', async () => {
    const records: Array<Record<string, unknown>> = [
      recorded([{tabId: 2, url: LOOSE}], Date.now() - 31_000),
      {[PAGE_TABS]: {tabs: [{tabId: 2, url: LOOSE}]}},
      {[PAGE_TABS]: {at: Date.now(), tabs: 'x'}},
      recorded([
        null,
        {tabId: 2},
        {tabId: 2, url: 'https://a.test/'},
        {tabId: 2, url: 'chrome-extension://someoneelse/x.html'}
      ])
    ]

    for (const local of records) {
      const h = boot({tabs: [{id: 2, url: LOOSE}], local})

      await vi.advanceTimersByTimeAsync(2000)

      expect([h.calls, h.created]).toEqual([[], []])
    }
  })

  it('does nothing where the extension cannot list tabs', async () => {
    const h = boot({
      noTabs: true,
      local: recorded([{tabId: 2, url: LOOSE}])
    })

    await vi.advanceTimersByTimeAsync(2000)

    expect(h.local[PAGE_TABS]).toBeDefined()
    expect([h.calls, h.created]).toEqual([[], []])
  })
})

describe('bridge producer runtime, a page the build ships as written', () => {
  beforeEach(() => {
    vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  const tabs: Tab[] = [
    {id: 1, url: 'https://a.test/loose/index.html'},
    {id: 2, url: LOOSE},
    {id: 3, url: `${LOOSE}?tab=1#top`},
    {id: 4, url: `${BASE}pages/extra.html`},
    {id: 5}
  ]

  // Such a page carries no dev client, so nothing else refreshes its tabs.
  it('reloads the open tabs that show the page, whatever their query, and no other', async () => {
    const h = boot({tabs})

    h.ws.triggerMessage({
      type: 'reload',
      reloadType: 'page',
      label: 'page (loose/index.html)',
      standalonePages: ['loose/index.html', 7, './pages/missing.html']
    })

    await vi.advanceTimersByTimeAsync(2000)

    expect(h.calls).toEqual(['tabs.reload 2 fresh', 'tabs.reload 3 fresh'])
  })

  it('leaves the tabs to the restart when the reload restarts the extension', async () => {
    const h = boot({tabs})

    h.ws.triggerMessage({
      type: 'reload',
      reloadType: 'service-worker',
      label: 'service_worker (background.js)',
      standalonePages: ['loose/index.html']
    })

    await vi.advanceTimersByTimeAsync(2000)

    expect(h.calls).toEqual(['runtime.reload'])
  })

  it('reloads no tab for a page reload that names none', async () => {
    const h = boot({tabs})

    h.ws.triggerMessage({
      type: 'reload',
      reloadType: 'page',
      label: 'page (pages/extra.html)'
    })

    await vi.advanceTimersByTimeAsync(2000)

    expect(h.calls).toEqual([])
  })
})

describe('bridge producer runtime, the build its background runs', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const helloOf = (ws: FakeWebSocket) =>
    ws.sent.map((raw) => JSON.parse(raw)).find((f) => f.type === 'hello')

  // The bundle names its build ahead of this runtime, and the broker compares
  // it with the build of a reload it held while the worker was away.
  it('names the build in its hello, and names none when the bundle set none', () => {
    expect(helloOf(boot({build: 'abc123'}).ws)).toMatchObject({
      role: 'producer',
      build: 'abc123'
    })

    expect('build' in helloOf(boot({}).ws)).toBe(false)
  })
})
