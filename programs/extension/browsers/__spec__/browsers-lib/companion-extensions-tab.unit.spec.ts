import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {createExtensionsPageTab} from '../../../../../extensions/extension-js-devtools/src/background/define-initial-tab'

type Tab = {id: number; url: string}

const EXTENSIONS_PAGE = 'chrome://extensions/'
const USER_TAB = {id: 1, url: 'https://example.com/'}

let open: Tab[]
let creates: Array<{url?: string; active?: boolean}>
let onRemovedListeners: Array<(tabId: number) => void>

function closeTab(id: number) {
  open = open.filter((tab) => tab.id !== id)

  for (const listener of [...onRemovedListeners]) listener(id)
}

function installChrome() {
  open = []
  creates = []
  onRemovedListeners = []

  vi.stubGlobal('chrome', {
    runtime: {id: 'companion', lastError: undefined},
    tabs: {
      query: (info: {url?: string}, cb: (tabs: Tab[]) => void) => {
        const found = open.filter((tab) => tab.url === info.url)

        setTimeout(() => cb(found), 0)
      },
      create: (
        props: {url?: string; active?: boolean},
        cb?: (tab: Tab) => void
      ) => {
        const tab = {id: 100 + creates.length, url: String(props.url)}

        creates.push(props)
        open.push(tab)
        setTimeout(() => cb?.(tab), 0)
      },
      move: (_id: number, _props: unknown, cb?: () => void) => cb?.(),
      update: () => undefined,
      onRemoved: {
        addListener: (fn: (tabId: number) => void) => {
          onRemovedListeners.push(fn)
        },
        removeListener: (fn: (tabId: number) => void) => {
          onRemovedListeners = onRemovedListeners.filter((l) => l !== fn)
        }
      }
    }
  })
}

describe('the extensions tab next to a user tab', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    installChrome()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('opens one in the background when none exists', async () => {
    createExtensionsPageTab(USER_TAB as never)
    await vi.advanceTimersByTimeAsync(10)

    expect(creates).toEqual([{url: EXTENSIONS_PAGE, active: false}])
    expect(onRemovedListeners).toHaveLength(0)
  })

  it('opens one when the tab it found is closed by the CLI', async () => {
    open = [{id: 7, url: EXTENSIONS_PAGE}]

    createExtensionsPageTab(USER_TAB as never)
    await vi.advanceTimersByTimeAsync(10)

    expect(creates).toEqual([])

    closeTab(7)
    await vi.advanceTimersByTimeAsync(10)

    expect(creates).toEqual([{url: EXTENSIONS_PAGE, active: false}])
    expect(onRemovedListeners).toHaveLength(0)
  })

  it('opens none while another extensions tab is still there', async () => {
    open = [
      {id: 7, url: EXTENSIONS_PAGE},
      {id: 8, url: EXTENSIONS_PAGE}
    ]

    createExtensionsPageTab(USER_TAB as never)
    await vi.advanceTimersByTimeAsync(10)
    closeTab(7)
    await vi.advanceTimersByTimeAsync(10)

    expect(creates).toEqual([])
  })

  it('ignores other tabs closing and stops watching in time', async () => {
    open = [{id: 7, url: EXTENSIONS_PAGE}]

    createExtensionsPageTab(USER_TAB as never)
    await vi.advanceTimersByTimeAsync(10)
    closeTab(1)
    await vi.advanceTimersByTimeAsync(10)

    expect(creates).toEqual([])

    await vi.advanceTimersByTimeAsync(30000)
    closeTab(7)
    await vi.advanceTimersByTimeAsync(10)

    expect(creates).toEqual([])
    expect(onRemovedListeners).toHaveLength(0)
  })
})
