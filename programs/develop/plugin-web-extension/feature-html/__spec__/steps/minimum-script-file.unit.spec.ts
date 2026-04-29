import {describe, it, expect, beforeEach, afterEach} from 'vitest'
import {pathToFileURL} from 'url'
import * as path from 'path'
import * as fs from 'fs'

/**
 * `programs/develop/dist/minimum-script-file.cjs` is bundled into every
 * dev-mode HTML entry and runs in the page on load. Its only job is to
 * append `rspack-dev-server-hot=false` (and the legacy
 * `webpack-dev-server-hot=false`) to `location.search`, which makes the
 * rspack-dev-server bundled client take the liveReload branch on rebuild
 * instead of the silent HMR-only branch — the bug that previously broke
 * HTML live reload for action/sidebar/new-tab pages on rspack 2.x.
 *
 * Locking in BOTH names: rspack-dev-server v1.x reads
 * `webpack-dev-server-hot=false`, v2.x reads `rspack-dev-server-hot=false`.
 * Setting both keeps us tolerant of either dev-server major shipping in
 * the user's lockfile.
 */
describe('minimum-script-file (dev page) query-param shim', () => {
  const builtPath = path.resolve(
    __dirname,
    '../../../../dist/minimum-script-file.cjs'
  )

  let storedPath = ''
  let originalLocation: any
  let originalHistory: any

  beforeEach(() => {
    if (!fs.existsSync(builtPath)) return
    originalLocation = (globalThis as any).location
    originalHistory = (globalThis as any).history

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
    storedPath = ''
  })

  it('writes both rspack- and webpack- prefixed hot=false on the URL', async () => {
    if (!fs.existsSync(builtPath)) {
      // Built artifact missing: the rslib build must have produced
      // dist/minimum-script-file.cjs for this test to assert on real output.
      throw new Error(
        `expected built dist/minimum-script-file.cjs at ${builtPath} — run \`pnpm compile\` first`
      )
    }

    // Re-import to force the side-effect side of the module to run against
    // the fresh fake DOM globals set up in beforeEach.
    const url = pathToFileURL(builtPath).href + '?t=' + Date.now()
    await import(url)

    expect(storedPath).toContain('rspack-dev-server-hot=false')
    expect(storedPath).toContain('webpack-dev-server-hot=false')
  })
})
