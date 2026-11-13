import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {
  buildBridgeProducerSource,
  buildDeclaredSheetSignalSource
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

// The bundles the browser ran in each frame, as each one names itself there.
interface Frame {
  frameId: number
  bundles: string[]
}

interface Tab {
  id: number
  url?: string
  frames?: Frame[]
}

interface Registration {
  id: string
  css?: string[]
  [key: string]: unknown
}

const SHEET = 'content_scripts/content-0.css'
const BUNDLE = 'content_scripts/content-0.11111111.js'
const OVERRIDES = '__extjsDevSheetOverrides'
const SESSION = '__extjsDevSheetSession'
const ENTRIES = '__extjsDevSheetEntries'
const REGISTRATION = 'extjs-dev-cs-sheet-0'
const DIGEST_A = 'a'.repeat(64)
const DIGEST_B = 'b'.repeat(64)
const ADDRESS_A = `${SHEET}?v=${'a'.repeat(16)}`
const ADDRESS_B = `${SHEET}?v=${'b'.repeat(16)}`

// Gecko's runtime.getManifest names content script files by full address.
const BASE = 'moz-extension://0e26c4a4-3cad-4dbf-a867-ba759974d94e/'

const ENTRY = {
  matches: ['http://probe.test/*'],
  js: [`${BASE}${BUNDLE}`],
  css: [`${BASE}${SHEET}`]
}

const RUNS_ENTRY: Frame[] = [{frameId: 0, bundles: [BUNDLE]}]

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
  registered?: Registration[]
}) {
  const calls: string[] = []
  const local: Record<string, unknown> = {...options.local}
  const session: Record<string, unknown> | null =
    options.session === null ? null : {...options.session}
  const tabs = options.tabs ?? [
    {id: 7, url: 'http://probe.test/', frames: RUNS_ENTRY}
  ]
  const registered: Registration[] = [...(options.registered ?? [])]
  const listeners: Array<(msg: unknown, sender: unknown) => void> = []
  const targetOf = (target: {tabId: number; frameIds?: number[]}) =>
    `${target.tabId}${target.frameIds ? `#${target.frameIds.join(',')}` : ''}`

  const css =
    (name: string) =>
    (
      details: {
        target: {tabId: number; frameIds?: number[]}
        files: string[]
      },
      cb?: () => void
    ) => {
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
      getRegisteredContentScripts: (cb: (list: unknown[]) => void) =>
        cb([...registered]),
      registerContentScripts: (list: Registration[], cb?: () => void) => {
        registered.push(...list)
        cb?.()
      },
      updateContentScripts: (list: Registration[], cb?: () => void) => {
        for (const next of list) {
          const at = registered.findIndex((each) => each.id === next.id)
          if (at !== -1) registered[at] = {...registered[at], ...next}
        }

        cb?.()
      },
      unregisterContentScripts: (filter: {ids: string[]}, cb?: () => void) => {
        for (const id of filter.ids) {
          const at = registered.findIndex((each) => each.id === id)
          if (at !== -1) registered.splice(at, 1)
        }

        cb?.()
      },
      // Runs the probe in each frame against the bundles that frame named.
      executeScript: (
        details: {
          target: {tabId: number}
          func: (...args: unknown[]) => unknown
          args: unknown[]
        },
        cb: (results: unknown[]) => void
      ) => {
        const tab = tabs.find((each) => each.id === details.target.tabId)
        const results = (tab?.frames ?? []).map((frame) => {
          const marks: Record<string, boolean> = {}
          for (const bundle of frame.bundles) marks[bundle] = true

          fakeGlobal[ENTRIES] = marks
          const result = details.func(...details.args)
          delete fakeGlobal[ENTRIES]

          return {frameId: frame.frameId, result}
        })

        cb(results)
      },
      insertCSS: css('insertCSS'),
      removeCSS: css('removeCSS')
    },
    tabs: {
      query: (_q: unknown, cb: (list: Tab[]) => void) => cb(tabs),
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
    registered,
    signal: (tabId: number, frameId = 0, file: unknown = BUNDLE) => {
      for (const fn of listeners) {
        fn({__extjsDevSheets: {file}}, {tab: {id: tabId}, frameId})
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

  // The new address goes in before the old copy leaves, so the frame is never
  // without the sheet and the new rules land last in the cascade.
  it('inserts the file under a fresh address in the frame that runs the entry, then drops the declared copy, with no reload', async () => {
    const h = boot({
      tabs: [
        {id: 7, url: 'http://probe.test/', frames: RUNS_ENTRY},
        {id: 8, url: 'http://other.test/', frames: [{frameId: 0, bundles: []}]}
      ]
    })

    h.ws.triggerMessage(sheetFrame(DIGEST_A))
    await vi.advanceTimersByTimeAsync(2000)

    expect(sheetCalls(h.calls)).toEqual([
      `insertCSS 7#0 ${ADDRESS_A}`,
      `removeCSS 7#0 ${SHEET}`
    ])

    expect(h.local[OVERRIDES]).toEqual({[SHEET]: DIGEST_A})
  })

  it('drops the address the previous edit inserted after it inserts the next', async () => {
    const h = boot({})

    h.ws.triggerMessage(sheetFrame(DIGEST_A))
    await vi.advanceTimersByTimeAsync(0)
    h.calls.length = 0
    h.ws.triggerMessage(sheetFrame(DIGEST_B))
    await vi.advanceTimersByTimeAsync(2000)

    expect(sheetCalls(h.calls)).toEqual([
      `insertCSS 7#0 ${ADDRESS_B}`,
      `removeCSS 7#0 ${SHEET}`,
      `removeCSS 7#0 ${ADDRESS_A}`
    ])

    expect(h.local[OVERRIDES]).toEqual({[SHEET]: DIGEST_B})
  })

  it('finds the entry when the manifest names the sheet by its bare path', async () => {
    const h = boot({contentScripts: [{...ENTRY, css: [SHEET]}]})

    h.ws.triggerMessage(sheetFrame(DIGEST_A))
    await vi.advanceTimersByTimeAsync(0)

    expect(sheetCalls(h.calls)).toEqual([
      `insertCSS 7#0 ${ADDRESS_A}`,
      `removeCSS 7#0 ${SHEET}`
    ])
  })

  // The tab address says nothing about its frames: the entry can run in a
  // frame of a tab it does not match, and stay out of a frame of one it does.
  it('swaps the sheet in each frame that runs the entry, whatever the tab shows', async () => {
    const h = boot({
      contentScripts: [
        {
          ...ENTRY,
          all_frames: true,
          exclude_matches: ['http://probe.test/excluded*']
        }
      ],
      tabs: [
        {
          id: 7,
          url: 'http://other.test/host',
          frames: [
            {frameId: 0, bundles: []},
            {frameId: 3, bundles: [BUNDLE]},
            {frameId: 5, bundles: []}
          ]
        },
        {
          id: 8,
          url: 'http://probe.test/top',
          frames: [
            {frameId: 0, bundles: [BUNDLE]},
            {frameId: 4, bundles: []},
            {frameId: 6, bundles: ['content_scripts/content-1.22222222.js']}
          ]
        }
      ]
    })

    h.ws.triggerMessage(sheetFrame(DIGEST_A))
    await vi.advanceTimersByTimeAsync(0)

    expect(sheetCalls(h.calls)).toEqual([
      `insertCSS 7#3 ${ADDRESS_A}`,
      `removeCSS 7#3 ${SHEET}`,
      `insertCSS 8#0 ${ADDRESS_A}`,
      `removeCSS 8#0 ${SHEET}`
    ])
  })

  it('asks a tab whose address the extension cannot read, and skips one no script can run in', async () => {
    const h = boot({
      tabs: [
        {id: 7, frames: RUNS_ENTRY},
        {id: 8, url: 'about:config', frames: RUNS_ENTRY}
      ]
    })

    h.ws.triggerMessage(sheetFrame(DIGEST_A))
    await vi.advanceTimersByTimeAsync(0)

    expect(sheetCalls(h.calls)).toEqual([
      `insertCSS 7#0 ${ADDRESS_A}`,
      `removeCSS 7#0 ${SHEET}`
    ])
  })

  // Registered at the entry's own run_at, the new address lands after the
  // declared copy in a later document, with nobody awake to correct it.
  it('registers the new address with the entry’s own matching, and moves it on the next edit', async () => {
    const h = boot({
      contentScripts: [
        {
          ...ENTRY,
          exclude_matches: ['http://probe.test/excluded*'],
          all_frames: true,
          run_at: 'document_start',
          match_origin_as_fallback: true
        }
      ]
    })

    h.ws.triggerMessage(sheetFrame(DIGEST_A))
    await vi.advanceTimersByTimeAsync(0)

    expect(h.registered).toEqual([
      {
        id: REGISTRATION,
        matches: ['http://probe.test/*'],
        excludeMatches: ['http://probe.test/excluded*'],
        css: [ADDRESS_A],
        runAt: 'document_start',
        allFrames: true,
        matchOriginAsFallback: true,
        persistAcrossSessions: false
      }
    ])

    h.ws.triggerMessage(sheetFrame(DIGEST_B))
    await vi.advanceTimersByTimeAsync(0)

    expect(h.registered.map((each) => [each.id, each.css])).toEqual([
      [REGISTRATION, [ADDRESS_B]]
    ])
  })

  it('registers nothing for a globbed entry, which has no registered form', async () => {
    const h = boot({
      contentScripts: [{...ENTRY, include_globs: ['*probe*']}]
    })

    h.ws.triggerMessage(sheetFrame(DIGEST_A))
    await vi.advanceTimersByTimeAsync(0)

    expect(h.registered).toEqual([])
    expect(sheetCalls(h.calls)).toEqual([
      `insertCSS 7#0 ${ADDRESS_A}`,
      `removeCSS 7#0 ${SHEET}`
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

  // The bundle that asks is one the browser ran in that frame, so the frame's
  // own address, its excludes and its place in the tab are already decided.
  it('corrects a document loaded after the swap in the frame that asked, for the entry whose bundle asked', async () => {
    const h = boot({
      session: {[SESSION]: 1},
      local: {[OVERRIDES]: {[SHEET]: DIGEST_A}},
      contentScripts: [
        ENTRY,
        {
          matches: ['<all_urls>'],
          all_frames: true,
          js: [`${BASE}content_scripts/content-1.22222222.js`]
        }
      ]
    })

    h.signal(7, 3)
    h.signal(7, 5, 'content_scripts/content-1.22222222.js')
    h.signal(8, 0, 'content_scripts/content-9.33333333.js')
    await vi.advanceTimersByTimeAsync(0)

    expect(sheetCalls(h.calls)).toEqual([
      `insertCSS 7#3 ${ADDRESS_A}`,
      `removeCSS 7#3 ${SHEET}`
    ])
  })

  it('ignores a signal that names no bundle', async () => {
    const h = boot({
      session: {[SESSION]: 1},
      local: {[OVERRIDES]: {[SHEET]: DIGEST_A}}
    })

    for (const file of [null, 7, {}]) h.signal(7, 0, file)

    await vi.advanceTimersByTimeAsync(0)

    expect(sheetCalls(h.calls)).toEqual([])
  })

  it('a wake of the event page keeps the overrides of the same extension load', async () => {
    const h = boot({
      session: {[SESSION]: 1},
      local: {[OVERRIDES]: {[SHEET]: DIGEST_A}},
      registered: [{id: REGISTRATION, css: [ADDRESS_A]}]
    })
    await vi.advanceTimersByTimeAsync(0)

    expect(h.local[OVERRIDES]).toEqual({[SHEET]: DIGEST_A})
    expect(h.registered).toHaveLength(1)
  })

  // The reload read every declared file again, so an address recorded for
  // the load before it would bring older bytes back, and win the cascade.
  it('a new load of the extension forgets the overrides, drops their registration and corrects nothing', async () => {
    const h = boot({
      local: {[OVERRIDES]: {[SHEET]: DIGEST_A}},
      registered: [
        {id: REGISTRATION, css: [ADDRESS_A]},
        {id: 'the-extension-own', css: ['own.css']}
      ]
    })

    h.signal(7)
    await vi.advanceTimersByTimeAsync(0)

    expect(h.local[OVERRIDES]).toBeUndefined()
    expect(h.session?.[SESSION]).toBeTruthy()
    expect(h.registered.map((each) => each.id)).toEqual(['the-extension-own'])
    expect(sheetCalls(h.calls)).toEqual([])
  })
})

function bundleIn(
  frame: Record<string, unknown>,
  options: {
    scheme: string
    file?: string
    overrides?: Record<string, string>
    storage?: boolean
  }
) {
  const sent: unknown[] = []
  let reads = 0

  frame.chrome = {
    runtime: {
      lastError: undefined,
      getURL: (file: string) => `${options.scheme}//abc/${file}`,
      sendMessage: (msg: unknown, cb?: () => void) => {
        sent.push(msg)
        cb?.()
      }
    },
    ...(options.storage === false
      ? {}
      : {
          storage: {
            local: {
              get: (
                key: string,
                cb: (res: Record<string, unknown>) => void
              ) => {
                reads++
                cb(options.overrides ? {[key]: options.overrides} : {})
              }
            }
          }
        })
  }

  // eslint-disable-next-line no-new-func
  new Function(
    'globalThis',
    buildDeclaredSheetSignalSource(options.file ?? BUNDLE)
  )(frame)

  return {sent, reads: () => reads}
}

describe('a declared content script bundle in a Firefox frame', () => {
  it('names itself to the frame and asks for the correction once a swap is recorded', () => {
    const frame: Record<string, unknown> = {}
    const first = bundleIn(frame, {
      scheme: 'moz-extension:',
      overrides: {[SHEET]: DIGEST_A, 'content_scripts/content-1.css': DIGEST_B}
    })

    expect(frame[ENTRIES]).toEqual({[BUNDLE]: true})
    expect(first.sent).toEqual([{__extjsDevSheets: {file: BUNDLE}}])
  })

  // Every bundle of a frame shares one world on Gecko, and each entry's sheet
  // lands at that entry's own run_at, so each one asks for itself.
  it('lets a second bundle in the same frame ask for its own entry, and never the same one twice', () => {
    const frame: Record<string, unknown> = {}
    const overrides = {[SHEET]: DIGEST_A}
    const other = 'content_scripts/content-1.22222222.js'

    bundleIn(frame, {scheme: 'moz-extension:', overrides})
    const second = bundleIn(frame, {
      scheme: 'moz-extension:',
      overrides,
      file: other
    })
    const again = bundleIn(frame, {scheme: 'moz-extension:', overrides})

    expect(frame[ENTRIES]).toEqual({[BUNDLE]: true, [other]: true})
    expect(second.sent).toEqual([{__extjsDevSheets: {file: other}}])
    expect([again.reads(), again.sent]).toEqual([0, []])
  })

  it('sends nothing, and wakes no event page, while no swap is recorded', () => {
    expect(bundleIn({}, {scheme: 'moz-extension:'}).sent).toEqual([])
    expect(
      bundleIn({}, {scheme: 'moz-extension:', overrides: {}}).sent
    ).toEqual([])
  })

  it('still names itself where the extension has no storage to read', () => {
    const frame: Record<string, unknown> = {}
    const r = bundleIn(frame, {scheme: 'moz-extension:', storage: false})

    expect(frame[ENTRIES]).toEqual({[BUNDLE]: true})
    expect(r.sent).toEqual([])
  })

  it('does nothing on Chromium, or in a world with no extension API', () => {
    const frame: Record<string, unknown> = {}
    const chromium = bundleIn(frame, {
      scheme: 'chrome-extension:',
      overrides: {[SHEET]: DIGEST_A}
    })

    expect([chromium.reads(), chromium.sent]).toEqual([0, []])
    expect(frame[ENTRIES]).toBeUndefined()

    const main: Record<string, unknown> = {}
    // eslint-disable-next-line no-new-func
    new Function('globalThis', buildDeclaredSheetSignalSource(BUNDLE))(main)

    expect(main[ENTRIES]).toBeUndefined()
  })
})
