import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import {CDPClient} from '../../run-chromium/chromium-source-inspection/cdp-client'

// Test forceReloadExtension: target ordering, retry logic, and fallback behavior.
// CDPClient is used directly with mocked internal methods.

describe('CDPClient.forceReloadExtension', () => {
  let client: CDPClient

  beforeEach(() => {
    vi.useFakeTimers()
    client = new CDPClient(9222, '127.0.0.1')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('tries service_worker targets before background_page targets', async () => {
    const extensionId = 'test-extension-id'
    const targetOrder: string[] = []

    ;(client as any).getTargets = vi.fn(async () => [
      {
        targetId: 'bg-target',
        type: 'background_page',
        url: `chrome-extension://${extensionId}/background.html`
      },
      {
        targetId: 'sw-target',
        type: 'service_worker',
        url: `chrome-extension://${extensionId}/sw.js`
      }
    ])

    ;(client as any).attachToTarget = vi.fn(async (targetId: string) => {
      targetOrder.push(targetId)
      return `session-${targetId}`
    })

    ;(client as any).sendCommand = vi.fn(async (method: string) => {
      if (method === 'Runtime.enable') return {}
      if (method === 'Runtime.evaluate') return {result: {value: true}}
      return {}
    })

    const reloadPromise = client.forceReloadExtension(extensionId)
    // Resolve all pending timers for backoff
    await vi.runAllTimersAsync()
    const ok = await reloadPromise

    expect(ok).toBe(true)
    // service_worker (sw-target) should be tried first
    expect(targetOrder[0]).toBe('sw-target')
  })

  it('tries next target type when first type fails evaluation', async () => {
    const extensionId = 'test-extension-id'
    const attemptedTypes: string[] = []

    ;(client as any).getTargets = vi.fn(async () => [
      {
        targetId: 'sw-target',
        type: 'service_worker',
        url: `chrome-extension://${extensionId}/sw.js`
      },
      {
        targetId: 'bg-target',
        type: 'background_page',
        url: `chrome-extension://${extensionId}/background.html`
      }
    ])

    ;(client as any).attachToTarget = vi.fn(async (targetId: string) => {
      attemptedTypes.push(targetId)
      if (targetId === 'sw-target') {
        throw new Error('Target closed')
      }
      return `session-${targetId}`
    })

    ;(client as any).sendCommand = vi.fn(async (method: string) => {
      if (method === 'Runtime.enable') return {}
      if (method === 'Runtime.evaluate') return {result: {value: true}}
      return {}
    })

    const reloadPromise = client.forceReloadExtension(extensionId)
    await vi.runAllTimersAsync()
    const ok = await reloadPromise

    expect(ok).toBe(true)
    // Both targets should have been attempted
    expect(attemptedTypes).toContain('sw-target')
    expect(attemptedTypes).toContain('bg-target')
  })

  it('returns false and warns when all attempts fail', async () => {
    const extensionId = 'test-extension-id'
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    ;(client as any).getTargets = vi.fn(async () => [])

    const reloadPromise = client.forceReloadExtension(extensionId)
    await vi.runAllTimersAsync()
    const ok = await reloadPromise

    expect(ok).toBe(false)
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('retries up to 8 times with backoff on repeated failures', async () => {
    const extensionId = 'test-extension-id'
    let getTargetsCalls = 0

    ;(client as any).getTargets = vi.fn(async () => {
      getTargetsCalls++
      return []
    })

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const reloadPromise = client.forceReloadExtension(extensionId)
    await vi.runAllTimersAsync()
    await reloadPromise

    expect(getTargetsCalls).toBe(8)
    warnSpy.mockRestore()
  })

  it('ignores targets from other extensions', async () => {
    const extensionId = 'my-extension-id'

    ;(client as any).getTargets = vi.fn(async () => [
      {
        targetId: 'other-sw',
        type: 'service_worker',
        url: 'chrome-extension://other-extension-id/sw.js'
      },
      {
        targetId: 'my-sw',
        type: 'service_worker',
        url: `chrome-extension://${extensionId}/sw.js`
      }
    ])

    const attached: string[] = []
    ;(client as any).attachToTarget = vi.fn(async (targetId: string) => {
      attached.push(targetId)
      return `session-${targetId}`
    })

    ;(client as any).sendCommand = vi.fn(async () => ({result: {value: true}}))

    const reloadPromise = client.forceReloadExtension(extensionId)
    await vi.runAllTimersAsync()
    const ok = await reloadPromise

    expect(ok).toBe(true)
    // Should only attach to our extension's target, not the other
    expect(attached).toEqual(['my-sw'])
  })

  it('does not reload sideloaded companion extensions (devtools/theme)', async () => {
    // Dev mode sideloads extension-js-devtools and extension-js-theme alongside
    // the user's extension via --load-extension. Their service workers appear
    // in CDP getTargets() with their own chrome-extension:// origins. A reload
    // triggered for the USER's extension must never attach to or evaluate
    // chrome.runtime.reload() inside a companion's worker — that would reload
    // the wrong extension and silently break dev workflow.
    const userExtensionId = 'user-extension-id'
    const devtoolsExtensionId = 'devtools-companion-id'
    const themeExtensionId = 'theme-companion-id'

    ;(client as any).getTargets = vi.fn(async () => [
      {
        targetId: 'devtools-sw',
        type: 'service_worker',
        url: `chrome-extension://${devtoolsExtensionId}/background/service_worker.js`
      },
      {
        targetId: 'theme-sw',
        type: 'service_worker',
        url: `chrome-extension://${themeExtensionId}/background/service_worker.js`
      },
      {
        targetId: 'user-sw',
        type: 'service_worker',
        url: `chrome-extension://${userExtensionId}/background.js`
      }
    ])

    const attached: string[] = []
    ;(client as any).attachToTarget = vi.fn(async (targetId: string) => {
      attached.push(targetId)
      return `session-${targetId}`
    })

    ;(client as any).sendCommand = vi.fn(async () => ({result: {value: true}}))

    const reloadPromise = client.forceReloadExtension(userExtensionId)
    await vi.runAllTimersAsync()
    const ok = await reloadPromise

    expect(ok).toBe(true)
    // The companion service workers must be filtered out by extensionId scope.
    // Only the user's worker may be attached for the chrome.runtime.reload() eval.
    expect(attached).toEqual(['user-sw'])
  })

  it('fires chrome.runtime.reload() at most once even when Runtime.evaluate hangs', async () => {
    // Regression: previously the eval response was awaited. When the reload
    // call killed the worker before CDP could return, the await threw, the
    // catch walked to the next matching target, and another
    // chrome.runtime.reload() got dispatched there. Editing _locales/en/
    // messages.json reliably reproduced this and the user saw the extension
    // flash multiple times for one save. The eval must be fire-and-forget.
    const extensionId = 'flash-extension-id'

    ;(client as any).getTargets = vi.fn(async () => [
      {
        targetId: 'sw-target',
        type: 'service_worker',
        url: `chrome-extension://${extensionId}/sw.js`
      },
      {
        targetId: 'page-target',
        type: 'page',
        url: `chrome-extension://${extensionId}/popup.html`
      }
    ])

    const attached: string[] = []
    ;(client as any).attachToTarget = vi.fn(async (targetId: string) => {
      attached.push(targetId)
      return `session-${targetId}`
    })

    let evaluateCalls = 0
    ;(client as any).sendCommand = vi.fn(async (method: string) => {
      if (method === 'Runtime.enable') return {}
      if (method === 'Runtime.evaluate') {
        evaluateCalls++
        // Simulate the SW dying mid-call: never resolve. The fix dispatches
        // the command without awaiting, so the outer code does not stall on
        // this and does not retry against the page target.
        return new Promise(() => {})
      }
      return {}
    })

    const reloadPromise = client.forceReloadExtension(extensionId)
    await vi.runAllTimersAsync()
    const ok = await reloadPromise

    expect(ok).toBe(true)
    // Only the SW target receives a reload. No fallback to popup/page targets.
    expect(attached).toEqual(['sw-target'])
    expect(evaluateCalls).toBe(1)
  })

  it('returns true on first success without exhausting all attempts', async () => {
    const extensionId = 'test-extension-id'
    let getTargetsCalls = 0

    ;(client as any).getTargets = vi.fn(async () => {
      getTargetsCalls++
      return [
        {
          targetId: 'sw-1',
          type: 'service_worker',
          url: `chrome-extension://${extensionId}/sw.js`
        }
      ]
    })

    ;(client as any).attachToTarget = vi.fn(async () => 'session-1')
    ;(client as any).sendCommand = vi.fn(async () => ({result: {value: true}}))

    const reloadPromise = client.forceReloadExtension(extensionId)
    await vi.runAllTimersAsync()
    const ok = await reloadPromise

    expect(ok).toBe(true)
    // Should succeed on first try, not all 8
    expect(getTargetsCalls).toBe(1)
  })
})
