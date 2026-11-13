import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {
  buildBridgeProducerSource,
  buildBridgeRelaySource
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
  triggerMessage(obj: unknown) {
    this.onmessage?.({data: JSON.stringify(obj)})
  }
}

interface Tab {
  id: number
  url: string
}

const SHEET = 'content_scripts/content-0.css'
const OVERRIDES = '__extjsDevSheetOverrides'
const SESSION = '__extjsDevSheetSession'
const DIGEST_A = 'a'.repeat(64)
const DIGEST_B = 'b'.repeat(64)
const ADDRESS_A = `${SHEET}?v=${'a'.repeat(16)}`
const ADDRESS_B = `${SHEET}?v=${'b'.repeat(16)}`

// Gecko's runtime.getManifest names content script files by full address.
const BASE = 'moz-extension://0e26c4a4-3cad-4dbf-a867-ba759974d94e/'

const ENTRY = {
  matches: ['http://probe.test/*'],
  js: [`${BASE}content_scripts/content-0.11111111.js`],
  css: [`${BASE}${SHEET}`]
}

function area(stored: Record<string, unknown>) {
  return {
    get: (key: string, cb: (res: Record<string, unknown>) => void) =>
      cb(key in stored ? {[key]: stored[key]} : {}),
    set: (items: Record<string, unknown>, cb?: () => void) => {
      Object.assign(stored, items)
      cb?.()
    },
    remove: (key: string, cb?: () => void) => {
      delete stored[key]
      cb?.()
    }
  }
}

// A Firefox event page whose manifest declares the stylesheet itself: Gecko
// applies it from a copy it keeps by address until the extension reloads.
function boot(options: {
  engine?: 'chromium' | 'firefox'
  contentScripts?: unknown[]
  tabs?: Tab[]
  local?: Record<string, unknown>
  session?: Record<string, unknown> | null
}) {
  const calls: string[] = []
  const local: Record<string, unknown> = {...options.local}
  const session: Record<string, unknown> | null =
    options.session === null ? null : {...options.session}
  const tabs = options.tabs ?? [{id: 7, url: 'http://probe.test/'}]
  const listeners: Array<(msg: unknown, sender: unknown) => void> = []
  const urlMatches = (pattern: string, url: string) =>
    pattern === '<all_urls>' || url.startsWith(pattern.replace(/\*$/, ''))
  const targetOf = (target: {
    tabId: number
    allFrames?: boolean
    frameIds?: number[]
  }) =>
    `${target.tabId}${target.frameIds ? `#${target.frameIds.join(',')}` : ''}${target.allFrames ? '#all' : ''}`

  const css =
    (name: string) =>
    (details: {target: {tabId: number}; files: string[]}, cb?: () => void) => {
      calls.push(
        `${name} ${targetOf(details.target)} ${details.files.join(',')}`
      )

      cb?.()
    }

  const chrome = {
    runtime: {
      lastError: undefined,
      reload: () => calls.push('runtime.reload'),
      getURL: (file: string) => `${BASE}${file}`,
      getManifest: () => ({
        content_scripts: options.contentScripts ?? [ENTRY]
      }),
      onMessage: {
        addListener: (fn: (msg: unknown, sender: unknown) => void) => {
          listeners.push(fn)
        }
      }
    },
    scripting: {
      getRegisteredContentScripts: (cb: (list: unknown[]) => void) => cb([]),
      insertCSS: css('insertCSS'),
      removeCSS: css('removeCSS')
    },
    tabs: {
      query: (q: {url?: string[]}, cb: (list: Tab[]) => void) =>
        cb(
          tabs.filter((tab) =>
            (q.url ?? []).some((pattern) => urlMatches(pattern, tab.url))
          )
        ),
      reload: (id: number) => calls.push(`tabs.reload ${id}`)
    },
    storage: {
      local: area(local),
      ...(session ? {session: area(session)} : {})
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
      options.engine === 'chromium' ? 'chrome-extension:' : 'moz-extension:'
  })

  FakeWebSocket.instances = []
  // eslint-disable-next-line no-new-func
  new Function(
    'globalThis',
    buildBridgeProducerSource({
      controlPort: 9999,
      instanceId: 'inst-S',
      context: 'background'
    })
  )(fakeGlobal)

  const ws = FakeWebSocket.instances[0]
  ws.onopen?.()

  return {
    ws,
    calls,
    local,
    session,
    signal: (tabId: number, frameId = 0) => {
      for (const fn of listeners) {
        fn({__extjsDevSheets: 1}, {tab: {id: tabId}, frameId})
      }
    }
  }
}

const sheetFrame = (digest: string) => ({
  type: 'reload',
  reloadType: 'content-scripts',
  label: 'content_script (content/styles.css)',
  changedFiles: ['content/styles.css'],
  changedContentScriptEntries: ['content_scripts/content-0'],
  refreshedStylesheets: [{file: SHEET, digest}]
})

const sheetCalls = (calls: string[]) =>
  calls.filter((call) =>
    /^(insertCSS|removeCSS|runtime\.reload|tabs\.reload)/.test(call)
  )

describe('bridge producer runtime, a stylesheet the Firefox manifest declares', () => {
  beforeEach(() => {
    vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('drops the declared copy from the matching tab and inserts the file under a fresh address, with no reload', async () => {
    const h = boot({
      tabs: [
        {id: 7, url: 'http://probe.test/'},
        {id: 8, url: 'http://other.test/'}
      ]
    })

    h.ws.triggerMessage(sheetFrame(DIGEST_A))
    await vi.advanceTimersByTimeAsync(2000)

    expect(sheetCalls(h.calls)).toEqual([
      `removeCSS 7 ${SHEET}`,
      `insertCSS 7 ${ADDRESS_A}`
    ])

    expect(h.local[OVERRIDES]).toEqual({[SHEET]: DIGEST_A})
  })

  it('removes the address the previous edit inserted before it inserts the next', async () => {
    const h = boot({})

    h.ws.triggerMessage(sheetFrame(DIGEST_A))
    await vi.advanceTimersByTimeAsync(0)
    h.calls.length = 0
    h.ws.triggerMessage(sheetFrame(DIGEST_B))
    await vi.advanceTimersByTimeAsync(2000)

    expect(sheetCalls(h.calls)).toEqual([
      `removeCSS 7 ${SHEET}`,
      `removeCSS 7 ${ADDRESS_A}`,
      `insertCSS 7 ${ADDRESS_B}`
    ])

    expect(h.local[OVERRIDES]).toEqual({[SHEET]: DIGEST_B})
  })

  it('finds the entry when the manifest names the sheet by its bare path', async () => {
    const h = boot({contentScripts: [{...ENTRY, css: [SHEET]}]})

    h.ws.triggerMessage(sheetFrame(DIGEST_A))
    await vi.advanceTimersByTimeAsync(0)

    expect(sheetCalls(h.calls)).toEqual([
      `removeCSS 7 ${SHEET}`,
      `insertCSS 7 ${ADDRESS_A}`
    ])
  })

  it('reloads the extension when no declared entry names the sheet', async () => {
    const h = boot({
      contentScripts: [{...ENTRY, css: [`${BASE}content_scripts/other.css`]}]
    })

    h.ws.triggerMessage(sheetFrame(DIGEST_A))
    await vi.advanceTimersByTimeAsync(2000)

    expect(sheetCalls(h.calls)).toEqual(['runtime.reload'])
    expect(h.local[OVERRIDES]).toBeUndefined()
  })

  it('reaches every frame of the tab for an all_frames entry', async () => {
    const h = boot({contentScripts: [{...ENTRY, all_frames: true}]})

    h.ws.triggerMessage(sheetFrame(DIGEST_A))
    await vi.advanceTimersByTimeAsync(0)

    expect(sheetCalls(h.calls)).toEqual([
      `removeCSS 7#all ${SHEET}`,
      `insertCSS 7#all ${ADDRESS_A}`
    ])
  })

  // No script runs in such a frame to ask for the correction on its next
  // navigation, so only a reload keeps later pages on the new bytes.
  it('reloads the extension when an entry that names the sheet has no script', async () => {
    const h = boot({
      contentScripts: [
        {matches: ['http://probe.test/*'], css: [`${BASE}${SHEET}`]}
      ]
    })

    h.ws.triggerMessage(sheetFrame(DIGEST_A))
    await vi.advanceTimersByTimeAsync(2000)

    expect(sheetCalls(h.calls)).toEqual(['runtime.reload'])
    expect(h.local[OVERRIDES]).toBeUndefined()
  })

  it('reloads the extension where session storage cannot tell a new load from a wake', async () => {
    const h = boot({session: null})

    h.ws.triggerMessage(sheetFrame(DIGEST_A))
    await vi.advanceTimersByTimeAsync(2000)

    expect(sheetCalls(h.calls)).toEqual(['runtime.reload'])
  })

  it('reloads the extension on an engine that is not Gecko', async () => {
    const h = boot({engine: 'chromium'})

    h.ws.triggerMessage(sheetFrame(DIGEST_A))
    await vi.advanceTimersByTimeAsync(2000)

    expect(sheetCalls(h.calls)).toEqual(['runtime.reload'])
  })

  it('corrects a document loaded after the swap, in the frame that asked and only where the entry matches', async () => {
    const h = boot({
      session: {[SESSION]: 1},
      local: {[OVERRIDES]: {[SHEET]: DIGEST_A}},
      tabs: [
        {id: 7, url: 'http://probe.test/'},
        {id: 8, url: 'http://other.test/'}
      ]
    })

    h.signal(7)
    h.signal(8)
    h.signal(7, 3)
    await vi.advanceTimersByTimeAsync(0)

    expect(sheetCalls(h.calls)).toEqual([
      `removeCSS 7#0 ${SHEET}`,
      `insertCSS 7#0 ${ADDRESS_A}`
    ])
  })

  it('a wake of the event page keeps the overrides of the same extension load', async () => {
    const h = boot({
      session: {[SESSION]: 1},
      local: {[OVERRIDES]: {[SHEET]: DIGEST_A}}
    })
    await vi.advanceTimersByTimeAsync(0)

    expect(h.local[OVERRIDES]).toEqual({[SHEET]: DIGEST_A})
  })

  // The reload read every declared file again, so an address recorded for
  // the load before it would bring older bytes back.
  it('a new load of the extension forgets the overrides and corrects nothing', async () => {
    const h = boot({local: {[OVERRIDES]: {[SHEET]: DIGEST_A}}})

    h.signal(7)
    await vi.advanceTimersByTimeAsync(0)

    expect(h.local[OVERRIDES]).toBeUndefined()
    expect(h.session?.[SESSION]).toBeTruthy()
    expect(sheetCalls(h.calls)).toEqual([])
  })
})

function relay(options: {
  scheme: string
  context?: string
  overrides?: Record<string, string>
}) {
  const sent: unknown[] = []
  let reads = 0
  const chrome = {
    runtime: {
      lastError: undefined,
      getURL: (file: string) => `${options.scheme}//abc/${file}`,
      sendMessage: (msg: unknown, cb?: () => void) => {
        sent.push(msg)
        cb?.()
      },
      connect: () => ({
        postMessage() {},
        onDisconnect: {addListener() {}},
        onMessage: {addListener() {}}
      }),
      onMessage: {addListener() {}}
    },
    storage: {
      local: {
        get: (key: string, cb: (res: Record<string, unknown>) => void) => {
          reads++
          cb(options.overrides ? {[key]: options.overrides} : {})
        }
      }
    }
  }

  // eslint-disable-next-line no-new-func
  new Function(
    'globalThis',
    buildBridgeRelaySource({context: (options.context ?? 'content') as never})
  )({chrome, console: {}, document: undefined})

  return {sent, reads: () => reads}
}

describe('bridge relay, a content script in a document loaded after a stylesheet swap', () => {
  it('asks the background for the correction once when a swap is recorded', () => {
    const r = relay({
      scheme: 'moz-extension:',
      overrides: {[SHEET]: DIGEST_A, 'content_scripts/content-1.css': DIGEST_B}
    })

    expect(r.sent).toEqual([{__extjsDevSheets: 1}])
  })

  it('sends nothing, and wakes no event page, while no swap is recorded', () => {
    expect(relay({scheme: 'moz-extension:'}).sent).toEqual([])
    expect(relay({scheme: 'moz-extension:', overrides: {}}).sent).toEqual([])
  })

  it('reads nothing on Chromium or from an extension page', () => {
    const chromium = relay({
      scheme: 'chrome-extension:',
      overrides: {[SHEET]: DIGEST_A}
    })
    const popup = relay({
      scheme: 'moz-extension:',
      context: 'popup',
      overrides: {[SHEET]: DIGEST_A}
    })

    expect([chromium.reads(), chromium.sent]).toEqual([0, []])
    expect([popup.reads(), popup.sent]).toEqual([0, []])
  })
})
