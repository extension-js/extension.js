import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

describe('preact-refresh-shim (dev page)', () => {
  beforeEach(() => {
    delete (globalThis as any).$RefreshReg$
    delete (globalThis as any).$RefreshSig$
    vi.resetModules()
  })

  afterEach(() => {
    delete (globalThis as any).$RefreshReg$
    delete (globalThis as any).$RefreshSig$
  })

  async function loadFreshShim() {
    return import('../../steps/preact-refresh-shim.ts')
  }

  it('installs no-op $RefreshReg$ and $RefreshSig$ when undefined', async () => {
    await loadFreshShim()
    expect(typeof (globalThis as any).$RefreshReg$).toBe('function')
    expect(typeof (globalThis as any).$RefreshSig$).toBe('function')

    const sig = (globalThis as any).$RefreshSig$()
    expect(typeof sig).toBe('function')
    const subject = {tag: 'Component'}
    expect(sig(subject)).toBe(subject)

    expect(() => (globalThis as any).$RefreshReg$(subject, 'id')).not.toThrow()
  })

  it('does not clobber existing $RefreshReg$ / $RefreshSig$', async () => {
    const realReg = function realRefreshReg() {}
    const realSig = function realRefreshSig() {
      return (type: unknown) => type
    }
    ;(globalThis as any).$RefreshReg$ = realReg
    ;(globalThis as any).$RefreshSig$ = realSig

    await loadFreshShim()

    expect((globalThis as any).$RefreshReg$).toBe(realReg)
    expect((globalThis as any).$RefreshSig$).toBe(realSig)
  })
})
