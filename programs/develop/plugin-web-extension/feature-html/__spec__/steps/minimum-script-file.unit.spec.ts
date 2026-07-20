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

  it('writes both rspack- and webpack- prefixed hot=false on the URL', async () => {
    await import('../../steps/minimum-script-file.ts')

    expect(storedPath).toContain('rspack-dev-server-hot=false')
    expect(storedPath).toContain('webpack-dev-server-hot=false')
  })
})
