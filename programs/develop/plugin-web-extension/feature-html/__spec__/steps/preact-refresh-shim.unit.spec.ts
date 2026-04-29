import {describe, it, expect, beforeEach, afterEach} from 'vitest'
import {pathToFileURL} from 'url'
import * as path from 'path'
import * as fs from 'fs'

/**
 * `programs/develop/dist/preact-refresh-shim.cjs` is the first module in
 * every dev-mode HTML entry chain. It exists so the user's bundle does not
 * crash with `$RefreshReg$ is not defined` when a refresh plugin is silently
 * mis-wired. The known case at the time of writing is
 * `@rspack/plugin-preact-refresh@1.1.4` against rspack 2.x, where the
 * plugin's HMR runtime intercept is keyed on `runtimeModule.constructorName`
 * (undefined in rspack 2.x), so the per-factory `$RefreshReg$` definition
 * never gets installed and the loader-injected top-level `$RefreshReg$()`
 * calls hit a ReferenceError.
 *
 * The shim must:
 *   1. Define `globalThis.$RefreshReg$` and `globalThis.$RefreshSig$` as
 *      no-ops when they are not already defined.
 *   2. Be a transparent backstop — must not clobber an existing definition.
 */
describe('preact-refresh-shim (dev page)', () => {
  const builtPath = path.resolve(
    __dirname,
    '../../../../dist/preact-refresh-shim.cjs'
  )

  beforeEach(() => {
    delete (globalThis as any).$RefreshReg$
    delete (globalThis as any).$RefreshSig$
  })

  afterEach(() => {
    delete (globalThis as any).$RefreshReg$
    delete (globalThis as any).$RefreshSig$
  })

  function loadFreshShim() {
    if (!fs.existsSync(builtPath)) {
      throw new Error(
        `expected built dist/preact-refresh-shim.cjs at ${builtPath} — run \`pnpm compile\` first`
      )
    }
    const url = pathToFileURL(builtPath).href + '?t=' + Date.now()
    return import(url)
  }

  it('installs no-op $RefreshReg$ and $RefreshSig$ when undefined', async () => {
    await loadFreshShim()
    expect(typeof (globalThis as any).$RefreshReg$).toBe('function')
    expect(typeof (globalThis as any).$RefreshSig$).toBe('function')

    // $RefreshSig$() returns an identity function so the loader's
    // `$RefreshSig$()(Component, key, forceReset, getCustomHooks)` calls
    // pass the component through unchanged.
    const sig = (globalThis as any).$RefreshSig$()
    expect(typeof sig).toBe('function')
    const subject = {tag: 'Component'}
    expect(sig(subject)).toBe(subject)

    // The fallback registration is a no-op — it must not throw with any args.
    expect(() => (globalThis as any).$RefreshReg$(subject, 'id')).not.toThrow()
  })

  it('does not clobber existing $RefreshReg$ / $RefreshSig$', async () => {
    const realReg = function realRefreshReg() {}
    const realSig = function realRefreshSig() {
      return function (type: unknown) {
        return type
      }
    }
    ;(globalThis as any).$RefreshReg$ = realReg
    ;(globalThis as any).$RefreshSig$ = realSig

    await loadFreshShim()

    expect((globalThis as any).$RefreshReg$).toBe(realReg)
    expect((globalThis as any).$RefreshSig$).toBe(realSig)
  })
})
