import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const mocks = vi.hoisted(() => ({
  connectToChromeCdpMock: vi.fn(),
  registerAutoEnableLoggingMock: vi.fn()
}))

vi.mock(
  '../../run-chromium/chromium-source-inspection/cdp-extension-controller/connect',
  () => ({
    connectToChromeCdp: mocks.connectToChromeCdpMock
  })
)

vi.mock(
  '../../run-chromium/chromium-source-inspection/cdp-extension-controller/logging',
  () => ({
    registerAutoEnableLogging: mocks.registerAutoEnableLoggingMock
  })
)

import {CDPExtensionController} from '../../run-chromium/chromium-source-inspection/cdp-extension-controller'

describe('CDPExtensionController hardReload', () => {
  const tempDirs: string[] = []

  beforeEach(() => {
    mocks.connectToChromeCdpMock.mockReset()
    mocks.registerAutoEnableLoggingMock.mockReset()
  })

  afterEach(() => {
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
      try {
        fs.rmSync(dir, {recursive: true, force: true})
      } catch {
        // ignore cleanup failures
      }
    }
  })

  it('reconnects and retries reload when the existing CDP socket is dead', async () => {
    const initialCdp = {
      forceReloadExtension: vi.fn(async () => false),
      disconnect: vi.fn()
    }
    const reconnectedCdp = {
      sendCommand: vi.fn(async () => ({})),
      forceReloadExtension: vi.fn(async () => true),
      disconnect: vi.fn()
    }

    mocks.connectToChromeCdpMock.mockResolvedValue(reconnectedCdp)

    const controller = new CDPExtensionController({
      outPath: '/tmp/ext',
      browser: 'chrome',
      cdpPort: 9222
    }) as any

    controller.cdp = initialCdp
    controller.extensionId = 'ext-id'
    controller.deriveExtensionIdFromTargets = vi.fn(async () => 'ext-id')

    const ok = await controller.hardReload()

    expect(ok).toBe(true)
    expect(initialCdp.forceReloadExtension).toHaveBeenCalledWith('ext-id')
    expect(initialCdp.disconnect).toHaveBeenCalledTimes(1)
    expect(mocks.connectToChromeCdpMock).toHaveBeenCalledWith(9222)
    expect(reconnectedCdp.sendCommand).toHaveBeenCalledWith(
      'Target.setDiscoverTargets',
      {discover: true}
    )
    expect(reconnectedCdp.sendCommand).toHaveBeenCalledWith(
      'Target.setAutoAttach',
      {
        autoAttach: true,
        waitForDebuggerOnStart: false,
        flatten: true
      }
    )
    expect(reconnectedCdp.forceReloadExtension).toHaveBeenCalledWith('ext-id')
  })

  it('reloads only page targets matching affected content script rules', async () => {
    const outPath = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-cdp-reinject-'))
    tempDirs.push(outPath)
    fs.mkdirSync(path.join(outPath, 'content_scripts'), {recursive: true})
    fs.writeFileSync(
      path.join(outPath, 'content_scripts', 'content-0.js'),
      'globalThis.__injected = (globalThis.__injected || 0) + 1;',
      'utf-8'
    )

    const protocolListeners = new Set<
      (message: Record<string, unknown>) => void
    >()
    const cdp = {
      getTargets: vi.fn(async () => [
        {
          targetId: 'page-1',
          type: 'page',
          url: 'https://docs.example.com/page'
        },
        {
          targetId: 'page-2',
          type: 'page',
          url: 'https://other.test/page'
        },
        {
          targetId: 'worker-1',
          type: 'service_worker',
          url: 'chrome-extension://abc/background.js'
        }
      ]),
      attachToTarget: vi.fn(async () => 'session-1'),
      onProtocolEvent: vi.fn(
        (handler: (message: Record<string, unknown>) => void) => {
          protocolListeners.add(handler)
          return () => protocolListeners.delete(handler)
        }
      ),
      evaluateInContext: vi.fn(async () => true),
      sendCommand: vi.fn(
        async (method: string, _params: any, sessionId?: string) => {
          if (method === 'Page.reload') {
            return {}
          }
          if (method === 'Page.getFrameTree') {
            return {frameTree: {frame: {id: 'frame-1'}}}
          }
          if (method === 'Runtime.enable') {
            for (const listener of protocolListeners) {
              listener({
                sessionId,
                method: 'Runtime.executionContextCreated',
                params: {
                  context: {
                    id: 7,
                    origin: 'chrome-extension://ext-id',
                    name: 'User Extension',
                    auxData: {
                      isDefault: false,
                      type: 'isolated',
                      frameId: 'frame-1'
                    }
                  }
                }
              })
            }
          }
          return {}
        }
      )
    }

    const controller = new CDPExtensionController({
      outPath,
      browser: 'chrome',
      cdpPort: 9222
    }) as any

    controller.cdp = cdp
    controller.extensionId = 'ext-id'

    const reloaded = await controller.reloadMatchingTabsForContentScripts([
      {
        index: 0,
        world: 'extension',
        matches: ['https://*.example.com/*'],
        excludeMatches: [],
        includeGlobs: [],
        excludeGlobs: []
      }
    ])

    expect(reloaded).toBe(1)
    expect(cdp.attachToTarget).toHaveBeenCalledWith('page-1')
    expect(cdp.evaluateInContext).toHaveBeenCalledWith(
      'session-1',
      expect.stringContaining(
        'extension.js-reinject://content_scripts/content-0.js'
      ),
      7
    )
  })

  it('can prefer page reloads for matching content scripts', async () => {
    const outPath = fs.mkdtempSync(
      path.join(os.tmpdir(), 'extjs-cdp-reload-page-')
    )
    tempDirs.push(outPath)

    const bundleDir = path.join(outPath, 'content_scripts')
    fs.mkdirSync(bundleDir, {recursive: true})
    fs.writeFileSync(
      path.join(bundleDir, 'content-0.js'),
      'console.log("content reload");'
    )

    const protocolListeners = new Set<
      (message: Record<string, unknown>) => void
    >()
    const cdp: any = {
      getTargets: vi.fn(async () => [
        {
          targetId: 'page-1',
          type: 'page',
          url: 'https://app.example.com/page'
        }
      ]),
      attachToTarget: vi.fn(async () => 'session-1'),
      onProtocolEvent: vi.fn(
        (handler: (message: Record<string, unknown>) => void) => {
          protocolListeners.add(handler)
          return () => protocolListeners.delete(handler)
        }
      ),
      evaluateInContext: vi.fn(async () => true),
      sendCommand: vi.fn(
        async (method: string, _params: any, sessionId?: string) => {
          if (method === 'Page.reload') {
            return {}
          }
          if (method === 'Page.getFrameTree') {
            return {frameTree: {frame: {id: 'frame-1'}}}
          }
          if (method === 'Runtime.enable') {
            for (const listener of protocolListeners) {
              listener({
                sessionId,
                method: 'Runtime.executionContextCreated',
                params: {
                  context: {
                    id: 7,
                    origin: 'chrome-extension://ext-id',
                    name: 'User Extension',
                    auxData: {
                      isDefault: false,
                      type: 'isolated',
                      frameId: 'frame-1'
                    }
                  }
                }
              })
            }
          }
          return {}
        }
      )
    }

    const controller = new CDPExtensionController({
      outPath,
      browser: 'chrome',
      cdpPort: 9222
    }) as any

    controller.cdp = cdp
    controller.extensionId = 'ext-id'

    const reloaded = await controller.reloadMatchingTabsForContentScripts(
      [
        {
          index: 0,
          world: 'extension',
          matches: ['https://*.example.com/*'],
          excludeMatches: [],
          includeGlobs: [],
          excludeGlobs: []
        }
      ],
      {preferPageReload: true}
    )

    expect(reloaded).toBe(1)
    expect(cdp.attachToTarget).toHaveBeenCalledWith('page-1')
    expect(cdp.sendCommand).toHaveBeenCalledWith(
      'Page.reload',
      {
        ignoreCache: true
      },
      'session-1'
    )
    expect(cdp.evaluateInContext).not.toHaveBeenCalled()
  })

  it('reports successful extension-runtime reinjection results', async () => {
    const outPath = fs.mkdtempSync(
      path.join(os.tmpdir(), 'extjs-runtime-reinject-success-')
    )
    tempDirs.push(outPath)
    fs.mkdirSync(path.join(outPath, 'content_scripts'), {recursive: true})
    fs.writeFileSync(
      path.join(outPath, 'content_scripts', 'content-0.js'),
      'console.log("runtime reinject");',
      'utf-8'
    )

    const cdp: any = {
      getTargets: vi.fn(async () => [
        {
          targetId: 'page-1',
          type: 'page',
          url: 'https://docs.example.com/page'
        },
        {
          targetId: 'runtime-1',
          type: 'service_worker',
          url: 'chrome-extension://ext-id/background/service_worker.js'
        }
      ]),
      attachToTarget: vi.fn(async () => 'runtime-session'),
      sendCommand: vi.fn(async () => ({})),
      evaluate: vi.fn(async () => ({
        reinjectedTabs: 1,
        hasRuntime: true,
        entries: 1,
        matches: [{index: 0, queriedTabs: 1, matchingTabs: 1}]
      }))
    }

    const controller = new CDPExtensionController({
      outPath,
      browser: 'chrome',
      cdpPort: 9222
    }) as any

    controller.cdp = cdp
    controller.extensionId = 'ext-id'

    const reloaded = await controller.reinjectMatchingTabsViaExtensionRuntime([
      {
        index: 0,
        world: 'extension',
        matches: ['https://*.example.com/*'],
        excludeMatches: [],
        includeGlobs: [],
        excludeGlobs: []
      }
    ])

    expect(reloaded).toBe(1)
    expect(cdp.attachToTarget).toHaveBeenCalledWith('runtime-1')
    expect(cdp.evaluate).toHaveBeenCalledWith(
      'runtime-session',
      expect.stringContaining('runtimeChrome.scripting.executeScript'),
      {awaitPromise: true}
    )
    expect(controller.getLastRuntimeReinjectionReport()).toEqual(
      expect.objectContaining({
        phase: 'evaluated',
        targetType: 'service_worker',
        targetUrl: 'chrome-extension://ext-id/background/service_worker.js',
        result: expect.objectContaining({
          reinjectedTabs: 1,
          hasRuntime: true
        })
      })
    )
  })

  it('reports missing chrome.scripting when extension-runtime reinjection cannot execute', async () => {
    const outPath = fs.mkdtempSync(
      path.join(os.tmpdir(), 'extjs-runtime-reinject-missing-scripting-')
    )
    tempDirs.push(outPath)
    fs.mkdirSync(path.join(outPath, 'content_scripts'), {recursive: true})
    fs.writeFileSync(
      path.join(outPath, 'content_scripts', 'content-0.js'),
      'console.log("runtime reinject");',
      'utf-8'
    )

    const cdp: any = {
      getTargets: vi.fn(async () => [
        {
          targetId: 'page-1',
          type: 'page',
          url: 'https://docs.example.com/page'
        },
        {
          targetId: 'runtime-1',
          type: 'service_worker',
          url: 'chrome-extension://ext-id/background/service_worker.js'
        }
      ]),
      attachToTarget: vi.fn(async () => 'runtime-session'),
      sendCommand: vi.fn(async () => ({})),
      evaluate: vi.fn(async () => ({
        reinjectedTabs: 0,
        hasRuntime: false,
        hasChrome: true,
        hasScripting: false,
        hasTabs: true,
        entries: 1,
        matches: []
      }))
    }

    const controller = new CDPExtensionController({
      outPath,
      browser: 'chrome',
      cdpPort: 9222
    }) as any

    controller.cdp = cdp
    controller.extensionId = 'ext-id'

    const reloaded = await controller.reinjectMatchingTabsViaExtensionRuntime([
      {
        index: 0,
        world: 'extension',
        matches: ['https://*.example.com/*'],
        excludeMatches: [],
        includeGlobs: [],
        excludeGlobs: []
      }
    ])

    expect(reloaded).toBe(0)
    expect(controller.getLastRuntimeReinjectionReport()).toEqual(
      expect.objectContaining({
        phase: 'evaluated',
        result: expect.objectContaining({
          reinjectedTabs: 0,
          hasRuntime: false,
          hasChrome: true,
          hasScripting: false,
          hasTabs: true
        })
      })
    )
  })

  it('preserves previous reinject generation in the temporary registry placeholder', () => {
    const controller = new CDPExtensionController({
      outPath: '/tmp/ext',
      browser: 'chrome',
      cdpPort: 9222
    }) as any

    const bundleId = 'content_scripts/content-0'
    const expression = controller.buildReinjectExpression(
      bundleId,
      `
globalThis.__capturedPreviousGeneration =
  globalThis.__EXTENSIONJS_DEV_REINJECT__[${JSON.stringify(bundleId)}].generation;
`,
      false
    )

    const originalDocument = (globalThis as any).document
    const originalElement = (globalThis as any).Element
    const originalMutationObserver = (globalThis as any).MutationObserver
    const originalSetTimeout = globalThis.setTimeout

    class FakeElement {
      private attrs = new Map<string, string>()
      isConnected = false
      setAttribute(name: string, value: string) {
        this.attrs.set(name, value)
      }
      getAttribute(name: string) {
        return this.attrs.get(name) || null
      }
      remove() {}
      querySelectorAll() {
        return []
      }
      matches() {
        return false
      }
    }

    class FakeMutationObserver {
      constructor(_: any) {}
      observe() {}
      disconnect() {}
    }

    const previousCleanup = vi.fn()
    ;(previousCleanup as any).__extjsGeneration = 4
    ;(globalThis as any).__EXTENSIONJS_DEV_REINJECT__ = {
      [bundleId]: previousCleanup
    }
    ;(globalThis as any).document = {
      documentElement: new FakeElement(),
      querySelectorAll: () => [],
      createElement: () => new FakeElement(),
      body: new FakeElement()
    }
    ;(globalThis as any).Element = FakeElement
    ;(globalThis as any).MutationObserver = FakeMutationObserver
    globalThis.setTimeout = ((fn: (...args: any[]) => any) => {
      fn()
      return 0 as any
    }) as typeof globalThis.setTimeout

    try {
      const result = eval(expression)
      expect(result).toEqual(
        expect.objectContaining({
          ok: true
        })
      )
      expect(previousCleanup).toHaveBeenCalledTimes(1)
      expect((globalThis as any).__capturedPreviousGeneration).toBe(4)
    } finally {
      globalThis.setTimeout = originalSetTimeout
      ;(globalThis as any).document = originalDocument
      ;(globalThis as any).Element = originalElement
      ;(globalThis as any).MutationObserver = originalMutationObserver
      delete (globalThis as any).__capturedPreviousGeneration
      delete (globalThis as any).__EXTENSIONJS_DEV_REINJECT__
    }
  })
})
