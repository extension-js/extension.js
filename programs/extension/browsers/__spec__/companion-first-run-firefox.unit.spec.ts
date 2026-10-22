import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {initManagerUI} from '../../../../extensions/extension-js-devtools/src/background/manager-ui'

// The companion learns its browser from a build-time constant, so the spec
// swaps the accessor and runs the Firefox first run against a mock chrome.
vi.mock(
  '../../../../extensions/extension-js-devtools/src/background/session-flags',
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    sessionBrowser: () => 'firefox'
  })
)

type Tab = {id: number; url: string}

let creates: Array<{url?: string; active?: boolean}>

function later(fn: () => void) {
  setTimeout(fn, 0)
}

function installFirefox(flags: Record<string, unknown>) {
  creates = []

  const chromeMock = {
    runtime: {
      id: 'companion',
      lastError: undefined,
      getURL: (p: string) => `moz-extension://companion/${p}`
    },
    management: {
      getAll: (cb: (list: unknown[]) => void) => later(() => cb([]))
    },
    storage: {
      local: {
        get: (_key: string, cb: (result: unknown) => void) =>
          later(() => cb({})),
        set: () => undefined
      }
    },
    tabs: {
      query: (
        info: {active?: boolean; url?: string},
        cb: (tabs: Tab[]) => void
      ) => {
        // The launch tab Firefox opened for the CLI, before any navigation.
        later(() => cb(info.active ? [{id: 1, url: 'about:blank'}] : []))
      },
      create: (
        props: {url: string; active?: boolean},
        cb?: (tab: Tab) => void
      ) => {
        creates.push({url: props.url, active: props.active})
        later(() => cb?.({id: creates.length + 1, url: props.url}))
      },
      update: () => undefined,
      move: (_id: number, _props: unknown, cb?: () => void) =>
        later(() => cb?.()),
      onUpdated: {
        addListener: () => undefined,
        removeListener: () => undefined
      }
    }
  }

  vi.stubGlobal('chrome', chromeMock)
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ok: true, json: async () => flags}))
  )
}

async function settle() {
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 0))
  }
}

function welcomeTab() {
  return creates.find((c) => c.url?.endsWith('pages/welcome.html'))
}

describe('companion first run on Firefox', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('opens the welcome page in front when the session has no starting URL', async () => {
    installFirefox({})
    await initManagerUI()
    await settle()

    expect(welcomeTab()).toEqual({
      url: 'moz-extension://companion/pages/welcome.html',
      active: true
    })
  })

  it('opens the welcome page behind the launch tab when a starting URL is coming', async () => {
    installFirefox({startingUrl: true})
    await initManagerUI()
    await settle()

    expect(welcomeTab()).toEqual({
      url: 'moz-extension://companion/pages/welcome.html',
      active: false
    })
  })

  it('opens nothing under --no-open, whatever else the session says', async () => {
    installFirefox({noOpen: true, startingUrl: true})
    await initManagerUI()
    await settle()

    expect(creates).toEqual([])
  })
})
