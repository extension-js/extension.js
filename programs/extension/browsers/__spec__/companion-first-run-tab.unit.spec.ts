import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {initManagerUI} from '../../../../extensions/extension-js-devtools/src/background/manager-ui'
import {decideRepoint} from '../../../../extensions/extension-js-devtools/src/background/start-pages'

type Tab = {id: number; url: string; pendingUrl?: string}

const START_TAB: Tab = {id: 1, url: 'chrome://newtab/'}
const AUTOMATION_TAB: Tab = {id: 2, url: 'https://example.com/'}

let activeQueries: Tab[]
let updates: Array<{tabId: number; url?: string}>
let onUpdatedListeners: Array<(...args: any[]) => void>

function later(fn: () => void) {
  setTimeout(fn, 0)
}

function installChrome() {
  activeQueries = [START_TAB, AUTOMATION_TAB]
  updates = []
  onUpdatedListeners = []

  const chromeMock = {
    runtime: {
      id: 'companion',
      lastError: undefined,
      getURL: (p: string) => `chrome-extension://companion/${p}`
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
        if (info.active) {
          const next = activeQueries.shift() ?? AUTOMATION_TAB
          later(() => cb([next]))

          return
        }

        later(() => cb([]))
      },
      create: (props: {url: string}, cb?: (tab: Tab) => void) => {
        later(() => cb?.({id: 3, url: props.url}))
      },
      update: (tabId: number, props: {url?: string}) => {
        updates.push({tabId, url: props.url})
      },
      move: (_id: number, _props: unknown, cb?: () => void) =>
        later(() => cb?.()),
      onUpdated: {
        addListener: (fn: (...args: any[]) => void) =>
          onUpdatedListeners.push(fn),
        removeListener: (fn: (...args: any[]) => void) => {
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
  it('repoints the start tab it checked, not a tab that became active later', async () => {
    await initManagerUI()
    await settle()

    const repointed = updates.filter((u) => u.url?.includes('://extensions'))

    expect(repointed.map((u) => u.tabId)).toEqual([START_TAB.id])
    expect(updates.some((u) => u.tabId === AUTOMATION_TAB.id && u.url)).toBe(
      false
    )
  })

  it('stops repointing once the start tab is on a page someone else opened', async () => {
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
