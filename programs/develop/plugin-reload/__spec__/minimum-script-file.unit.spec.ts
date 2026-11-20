import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

// The page globals the shim reads. Node's typings carry none of them.
interface PageLocation {
  protocol: string
  href: string
  search: string
}

interface PageGlobals {
  location?: PageLocation
  history?: unknown
  [key: string]: unknown
}

const page = globalThis as unknown as PageGlobals
const pageLocation = () => page.location as PageLocation

describe('minimum-script-file (dev page) query-param shim', () => {
  let storedPath = ''
  let originalLocation: PageLocation | undefined
  let originalHistory: unknown

  beforeEach(() => {
    originalLocation = page.location
    originalHistory = page.history
    storedPath = ''

    const fakeWindow = {
      location: {
        protocol: 'chrome-extension:',
        href: 'chrome-extension://abc/sidebar/index.html',
        search: ''
      },
      history: {
        replaceState(_state: unknown, _title: string, url: string) {
          storedPath = url
          fakeWindow.location.href = url
          const idx = url.indexOf('?')
          fakeWindow.location.search = idx >= 0 ? url.slice(idx) : ''
        }
      }
    }

    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      writable: true,
      value: fakeWindow.location
    })

    Object.defineProperty(globalThis, 'history', {
      configurable: true,
      writable: true,
      value: fakeWindow.history
    })

    vi.resetModules()
  })

  afterEach(() => {
    if (originalLocation === undefined) {
      delete page.location
    } else {
      Object.defineProperty(globalThis, 'location', {
        configurable: true,
        writable: true,
        value: originalLocation
      })
    }

    if (originalHistory === undefined) {
      delete page.history
    } else {
      Object.defineProperty(globalThis, 'history', {
        configurable: true,
        writable: true,
        value: originalHistory
      })
    }
  })

  it('leaves a clean extension page URL untouched so HMR stays enabled', async () => {
    await import('../reload-lib/minimum-files/minimum-script-file.ts')

    expect(storedPath).toBe('')
    expect(pageLocation().search).toBe('')
  })

  it('scrubs stale hot=false guards written by older dev sessions', async () => {
    pageLocation().href =
      'chrome-extension://abc/options/index.html?rspack-dev-server-hot=false&webpack-dev-server-hot=false'

    pageLocation().search =
      '?rspack-dev-server-hot=false&webpack-dev-server-hot=false'

    await import('../reload-lib/minimum-files/minimum-script-file.ts')

    expect(storedPath).toBe('chrome-extension://abc/options/index.html')
    expect(storedPath).not.toContain('dev-server-hot')
  })

  it('keeps unrelated query params while scrubbing the guards', async () => {
    pageLocation().href =
      'chrome-extension://abc/options/index.html?tab=general&webpack-dev-server-hot=false'

    pageLocation().search = '?tab=general&webpack-dev-server-hot=false'

    await import('../reload-lib/minimum-files/minimum-script-file.ts')

    expect(storedPath).toContain('tab=general')
    expect(storedPath).not.toContain('dev-server-hot')
  })
})

describe('minimum-script-file (dev page) html-change reload', () => {
  let listeners: Array<(event: {data?: unknown}) => void>
  let served: string
  let reloads: number
  const saved: Record<string, unknown> = {}

  function install(key: string, value: unknown) {
    saved[key] = page[key]
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value
    })
  }

  beforeEach(() => {
    listeners = []
    served = '<html><body>v1</body></html>'
    reloads = 0
    install('location', {
      protocol: 'chrome-extension:',
      href: 'chrome-extension://abc/action/index.html',
      search: '',
      reload: () => {
        reloads += 1
      }
    })

    install('history', {replaceState() {}})
    install(
      'addEventListener',
      (type: string, fn: (event: {data?: unknown}) => void) => {
        if (type === 'message') listeners.push(fn)
      }
    )

    install('fetch', async () => ({ok: true, text: async () => served}))
    vi.useFakeTimers()
    vi.resetModules()
  })

  afterEach(() => {
    vi.useRealTimers()

    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete page[key]
      else {
        Object.defineProperty(globalThis, key, {
          configurable: true,
          writable: true,
          value: saved[key]
        })
      }
    }
  })

  async function settle() {
    for (let i = 0; i < 6; i += 1) await Promise.resolve()
  }

  async function announceHash() {
    for (const fn of listeners) fn({data: 'webpackHotUpdateabc123'})
    await settle()
  }

  it('listens for the dev-server client hash message on an extension page', async () => {
    await import('../reload-lib/minimum-files/minimum-script-file.ts')
    await settle()
    expect(listeners).toHaveLength(1)
  })

  it('reloads when the served markup changed since the page loaded', async () => {
    await import('../reload-lib/minimum-files/minimum-script-file.ts')
    await settle()
    served = '<html><body>v2 DevLiveHtmlUpdate</body></html>'
    await announceHash()
    expect(reloads).toBe(1)
  })

  it('keeps the page (and its HMR state) when only scripts or styles changed', async () => {
    await import('../reload-lib/minimum-files/minimum-script-file.ts')
    await settle()
    await announceHash()
    await vi.advanceTimersByTimeAsync(600)
    expect(reloads).toBe(0)
  })

  it('takes a second look when the markup lands after the message', async () => {
    await import('../reload-lib/minimum-files/minimum-script-file.ts')
    await settle()
    await announceHash()
    served = '<html><body>v2</body></html>'
    await vi.advanceTimersByTimeAsync(600)
    expect(reloads).toBe(1)
  })

  it('does nothing on a plain web page', async () => {
    pageLocation().protocol = 'https:'
    pageLocation().href = 'https://example.com/'
    await import('../reload-lib/minimum-files/minimum-script-file.ts')
    await settle()
    expect(listeners).toHaveLength(0)
  })
})
