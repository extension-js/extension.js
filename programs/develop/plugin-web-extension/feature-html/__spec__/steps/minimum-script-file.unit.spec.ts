import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest'

/**
 * `minimum-script-file.ts` is bundled into every dev-mode HTML entry and
 * runs in the page on load. Its only job is to append
 * `rspack-dev-server-hot=false` (and the legacy
 * `webpack-dev-server-hot=false`) to `location.search`, which makes the
 * rspack-dev-server bundled client take the liveReload branch on rebuild
 * instead of the silent HMR-only branch — the bug that previously broke
 * HTML live reload for action/sidebar/new-tab pages on rspack 2.x.
 *
 * Locking in BOTH names: rspack-dev-server v1.x reads
 * `webpack-dev-server-hot=false`, v2.x reads `rspack-dev-server-hot=false`.
 * Setting both keeps us tolerant of either dev-server major shipping in
 * the user's lockfile.
 *
 * Imported from source (vitest TS transform). Avoids a hard dependency on
 * `pnpm compile` running before tests in CI.
 */
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
    // vi.resetModules() above forces a fresh evaluation of the module's
    // top-level side effects against the fake DOM globals set up in
    // beforeEach.
    await import('../../steps/minimum-script-file.ts')

    expect(storedPath).toContain('rspack-dev-server-hot=false')
    expect(storedPath).toContain('webpack-dev-server-hot=false')
  })
})
