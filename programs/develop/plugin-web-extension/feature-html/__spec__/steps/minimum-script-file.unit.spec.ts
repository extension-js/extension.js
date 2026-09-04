import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

describe('minimum-script-file (dev page) query-param shim', () => {
  let storedPath = ''
  let originalLocation: any
  let originalHistory: any

  beforeEach(() => {
    originalLocation = (globalThis as any).location
    originalHistory = (globalThis as any).history
    storedPath = ''

    const fakeWindow: any = {
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
      delete (globalThis as any).location
    } else {
      Object.defineProperty(globalThis, 'location', {
        configurable: true,
        writable: true,
        value: originalLocation
      })
    }
    if (originalHistory === undefined) {
      delete (globalThis as any).history
    } else {
      Object.defineProperty(globalThis, 'history', {
        configurable: true,
        writable: true,
        value: originalHistory
      })
    }
  })

  it('leaves a clean extension page URL untouched so HMR stays enabled', async () => {
    await import('../../steps/minimum-script-file.ts')

    expect(storedPath).toBe('')
    expect((globalThis as any).location.search).toBe('')
  })

  it('scrubs stale hot=false guards written by older dev sessions', async () => {
    ;(globalThis as any).location.href =
      'chrome-extension://abc/options/index.html?rspack-dev-server-hot=false&webpack-dev-server-hot=false'
    ;(globalThis as any).location.search =
      '?rspack-dev-server-hot=false&webpack-dev-server-hot=false'

    await import('../../steps/minimum-script-file.ts')

    expect(storedPath).toBe('chrome-extension://abc/options/index.html')
    expect(storedPath).not.toContain('dev-server-hot')
  })

  it('keeps unrelated query params while scrubbing the guards', async () => {
    ;(globalThis as any).location.href =
      'chrome-extension://abc/options/index.html?tab=general&webpack-dev-server-hot=false'
    ;(globalThis as any).location.search =
      '?tab=general&webpack-dev-server-hot=false'

    await import('../../steps/minimum-script-file.ts')

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
    saved[key] = (globalThis as any)[key]
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
    install('addEventListener', (type: string, fn: any) => {
      if (type === 'message') listeners.push(fn)
    })
    install('fetch', async () => ({ok: true, text: async () => served}))
    vi.useFakeTimers()
    vi.resetModules()
  })

  afterEach(() => {
    vi.useRealTimers()
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete (globalThis as any)[key]
      else
        Object.defineProperty(globalThis, key, {
          configurable: true,
          writable: true,
          value: saved[key]
        })
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
    await import('../../steps/minimum-script-file.ts')
    await settle()
    expect(listeners).toHaveLength(1)
  })

  it('reloads when the served markup changed since the page loaded', async () => {
    await import('../../steps/minimum-script-file.ts')
    await settle()
    served = '<html><body>v2 DevLiveHtmlUpdate</body></html>'
    await announceHash()
    expect(reloads).toBe(1)
  })

  it('keeps the page (and its HMR state) when only scripts or styles changed', async () => {
    await import('../../steps/minimum-script-file.ts')
    await settle()
    await announceHash()
    await vi.advanceTimersByTimeAsync(600)
    expect(reloads).toBe(0)
  })

  it('takes a second look when the markup lands after the message', async () => {
    await import('../../steps/minimum-script-file.ts')
    await settle()
    await announceHash()
    served = '<html><body>v2</body></html>'
    await vi.advanceTimersByTimeAsync(600)
    expect(reloads).toBe(1)
  })

  it('does nothing on a plain web page', async () => {
    ;(globalThis as any).location.protocol = 'https:'
    ;(globalThis as any).location.href = 'https://example.com/'
    await import('../../steps/minimum-script-file.ts')
    await settle()
    expect(listeners).toHaveLength(0)
  })
})
