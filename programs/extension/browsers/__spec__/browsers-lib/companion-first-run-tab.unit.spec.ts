import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {initManagerUI} from '../../../../../extensions/extension-js-devtools/src/background/manager-ui'
import {decideRepoint} from '../../../../../extensions/extension-js-devtools/src/background/start-pages'

type Tab = {id: number; url: string; pendingUrl?: string}

// The tabs.onUpdated arguments the stand-in fires: tab id, change and tab.
type OnUpdatedListener = (
  tabId: number,
  change: {status?: string},
  tab: Tab
) => void

const START_TAB: Tab = {id: 1, url: 'chrome://newtab/'}
const AUTOMATION_TAB: Tab = {id: 2, url: 'https://example.com/'}

let activeQueries: Tab[]
let updates: Array<{tabId: number; url?: string}>
let creates: Array<{url?: string; active?: boolean}>
let removed: number[]
let startTabNow: Tab
let didRun: boolean
let refuseExtensionsTab: boolean
let onUpdatedListeners: Array<OnUpdatedListener>

function later(fn: () => void) {
  setTimeout(fn, 0)
}

function installChrome() {
  activeQueries = [START_TAB, AUTOMATION_TAB]
  updates = []
  creates = []
  removed = []
  startTabNow = START_TAB
  didRun = false
  refuseExtensionsTab = false
  onUpdatedListeners = []

  const chromeMock = {
    runtime: {
      id: 'companion',
      lastError: undefined as {message: string} | undefined,
      getURL: (p: string) => `chrome-extension://companion/${p}`
    },
    management: {
      getAll: (cb: (list: unknown[]) => void) => later(() => cb([]))
    },
    storage: {
      local: {
        get: (_key: string, cb: (result: unknown) => void) =>
          later(() => cb(didRun ? {'__first_run__:chromium': {didRun}} : {})),
        set: () => undefined
      }
    },
    tabs: {
      query: (
        info: {active?: boolean; url?: string},
        cb: (tabs: Tab[]) => void
      ) => {
        if (info.active) {
          const next = activeQueries.shift() ?? AUTOMATION_TAB
          later(() => cb([next]))

          return
        }

        later(() => cb([]))
      },
      create: (
        props: {url?: string; active?: boolean},
        cb?: (tab?: Tab) => void
      ) => {
        creates.push(props)

        later(() => {
          if (refuseExtensionsTab && props.url?.includes('://extensions')) {
            chromeMock.runtime.lastError = {message: 'refused'}
            cb?.(undefined)
            chromeMock.runtime.lastError = undefined

            return
          }

          cb?.({id: 3 + creates.length, url: props.url ?? 'chrome://newtab/'})
        })
      },
      get: (_id: number, cb: (tab: Tab) => void) =>
        later(() => cb(startTabNow)),
      remove: (tabId: number, cb?: () => void) => {
        removed.push(tabId)
        later(() => cb?.())
      },
      update: (tabId: number, props: {url?: string}) => {
        updates.push({tabId, url: props.url})
      },
      move: (_id: number, _props: unknown, cb?: () => void) =>
        later(() => cb?.()),
      onUpdated: {
        addListener: (fn: OnUpdatedListener) => onUpdatedListeners.push(fn),
        removeListener: (fn: OnUpdatedListener) => {
          onUpdatedListeners = onUpdatedListeners.filter((l) => l !== fn)
        }
      }
    }
  }

  vi.stubGlobal('chrome', chromeMock)
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ok: false, json: async () => ({})}))
  )
}

async function settle() {
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 0))
  }
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
  installChrome()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('companion first run', () => {
  it('replaces the start tab it checked with a new extensions tab', async () => {
    await initManagerUI()
    await settle()

    const extensionsTabs = creates.filter((c) =>
      c.url?.includes('://extensions')
    )

    expect(extensionsTabs).toEqual([
      {url: 'chrome://extensions/', active: false, index: 0}
    ])

    expect(removed).toEqual([START_TAB.id])
    expect(updates.some((u) => u.url)).toBe(false)
  })

  it('leaves the start tab open once it is on a page someone else opened', async () => {
    startTabNow = {id: START_TAB.id, url: 'https://example.com/'}

    await initManagerUI()
    await settle()

    expect(removed).toEqual([])
    expect(updates.some((u) => u.url)).toBe(false)
  })

  it('reuses the start tab when the new extensions tab is refused', async () => {
    refuseExtensionsTab = true

    await initManagerUI()
    await settle()

    const repointed = updates.filter((u) => u.url?.includes('://extensions'))

    expect(removed).toEqual([])
    expect(repointed.map((u) => u.tabId)).toEqual([START_TAB.id])
    expect(updates.some((u) => u.tabId === AUTOMATION_TAB.id && u.url)).toBe(
      false
    )
  })

  it('stops reusing once the start tab is on a page someone else opened', async () => {
    refuseExtensionsTab = true

    await initManagerUI()
    await settle()

    const before = updates.length

    for (const listener of onUpdatedListeners) {
      listener(
        START_TAB.id,
        {status: 'complete'},
        {
          id: START_TAB.id,
          url: 'https://example.com/'
        }
      )
    }

    expect(updates.length).toBe(before)
    expect(onUpdatedListeners.length).toBe(0)
  })

  it('reads the start tab again when it reports no url yet', async () => {
    activeQueries = [{id: START_TAB.id, url: ''}]

    await initManagerUI()
    await new Promise((r) => setTimeout(r, 200))
    await settle()

    expect(creates.map((c) => c.url)).toEqual([
      'chrome-extension://companion/pages/welcome.html',
      'chrome://extensions/'
    ])

    expect(removed).toEqual([START_TAB.id])
  })

  it('gives a later run a clean new tab and no welcome page', async () => {
    didRun = true

    await initManagerUI()
    await settle()

    expect(creates).toEqual([{active: true, index: 0}])
    expect(removed).toEqual([START_TAB.id])
  })
})

describe('decideRepoint', () => {
  it('stops on a tab that left the start page for another page', () => {
    expect(
      decideRepoint({
        tabId: 1,
        updatedTabId: 1,
        status: 'complete',
        url: 'https://example.com/',
        targetUrl: 'chrome://extensions/',
        attempts: 0
      })
    ).toBe('stop')
  })

  it('still repoints a start page that a redirect put back', () => {
    expect(
      decideRepoint({
        tabId: 1,
        updatedTabId: 1,
        status: 'complete',
        url: 'https://ya.ru/',
        targetUrl: 'chrome://extensions/',
        attempts: 1
      })
    ).toBe('repoint')
  })
})
