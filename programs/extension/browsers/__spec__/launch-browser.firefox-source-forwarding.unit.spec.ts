import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

// Capture the host (FirefoxPluginRuntime) handed to FirefoxLaunchPlugin so we
// can assert that source-inspection fields flow from launchBrowser() all the
// way into the Firefox launch path. Historically this layer dropped source*
// on the floor for Firefox; this spec guards against a silent-drop regression.
const constructorCalls: Array<{host: any; ctx: any}> = []

vi.mock('../run-firefox/firefox-launch', () => {
  class FirefoxLaunchPlugin {
    constructor(host: any, ctx: any) {
      constructorCalls.push({host, ctx})
    }
    async runOnce(_compilation: any, _options: any) {
      // no-op: dryRun semantics
    }
    apply(_compiler: any) {}
  }
  return {FirefoxLaunchPlugin}
})

vi.mock('../run-firefox/firefox-context', async () => {
  // Keep the real factory shape but expose a stable getController that
  // returns a spy-friendly controller we can wire to later.
  const rdpController = {
    enableUnifiedLogging: vi.fn().mockResolvedValue(undefined)
  }

  function createFirefoxContext() {
    return {
      getController: () => rdpController,
      onControllerReady: (_cb: any) => {},
      setController: (_c: any, _p: any) => {},
      getPorts: () => ({}),
      setExtensionRoot: (_r?: string) => {},
      getExtensionRoot: () => undefined,
      setServiceWorkerPaths: (_r?: string, _a?: string) => {},
      getServiceWorkerPaths: () => ({}),
      setPendingReloadReason: (_r?: any) => {},
      getPendingReloadReason: () => undefined,
      clearPendingReloadReason: () => {},
      logger: undefined,
      didLaunch: false
    }
  }

  return {createFirefoxContext, __rdpController: rdpController}
})

import {launchBrowser} from '../index'

describe('launchBrowser (firefox): source inspection option forwarding', () => {
  beforeEach(() => {
    constructorCalls.length = 0
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('forwards --source* fields into FirefoxLaunchPlugin host', async () => {
    await launchBrowser({
      browser: 'firefox',
      outputPath: '/tmp/x',
      contextDir: '/tmp/x',
      extensionsToLoad: ['/tmp/ext'],
      mode: 'development',
      dryRun: true,
      source: 'https://example.com',
      watchSource: true,
      sourceFormat: 'json',
      sourceSummary: true,
      sourceMeta: true,
      sourceProbe: ['h1', '.foo'],
      sourceTree: 'root-only',
      sourceConsole: true,
      sourceDom: true,
      sourceMaxBytes: 65536,
      sourceRedact: 'strict',
      sourceIncludeShadow: 'all',
      sourceDiff: true
    } as any)

    expect(constructorCalls).toHaveLength(1)
    const {host} = constructorCalls[0]
    expect(host.source).toBe('https://example.com')
    expect(host.watchSource).toBe(true)
    expect(host.sourceFormat).toBe('json')
    expect(host.sourceSummary).toBe(true)
    expect(host.sourceMeta).toBe(true)
    expect(host.sourceProbe).toEqual(['h1', '.foo'])
    expect(host.sourceTree).toBe('root-only')
    expect(host.sourceConsole).toBe(true)
    expect(host.sourceDom).toBe(true)
    expect(host.sourceMaxBytes).toBe(65536)
    expect(host.sourceRedact).toBe('strict')
    expect(host.sourceIncludeShadow).toBe('all')
    expect(host.sourceDiff).toBe(true)
  })

  it('forwards unified-logger fields into FirefoxLaunchPlugin host', async () => {
    await launchBrowser({
      browser: 'firefox',
      outputPath: '/tmp/x',
      contextDir: '/tmp/x',
      extensionsToLoad: ['/tmp/ext'],
      mode: 'development',
      dryRun: true,
      logLevel: 'info',
      logContexts: ['background', 'content'],
      logFormat: 'ndjson',
      logTimestamps: false,
      logColor: false,
      logUrl: 'example.com',
      logTab: 42
    } as any)

    expect(constructorCalls).toHaveLength(1)
    const {host} = constructorCalls[0]
    expect(host.logLevel).toBe('info')
    expect(host.logContexts).toEqual(['background', 'content'])
    expect(host.logFormat).toBe('ndjson')
    expect(host.logTimestamps).toBe(false)
    expect(host.logColor).toBe(false)
    expect(host.logUrl).toBe('example.com')
    expect(host.logTab).toBe(42)
  })

  it('returns a controller that exposes enableUnifiedLogging() (delegating to the FirefoxRDPController) but no reload()', async () => {
    const controller = await launchBrowser({
      browser: 'firefox',
      outputPath: '/tmp/x',
      contextDir: '/tmp/x',
      extensionsToLoad: ['/tmp/ext'],
      mode: 'development',
      dryRun: true
    } as any)

    const mod: any = await import('../run-firefox/firefox-context')
    const rdp = mod.__rdpController

    // Reload is owned by the dev server's control-bridge SW producer (the same
    // executor as `--no-browser`), not the RDP controller.
    expect((controller as any).reload).toBeUndefined()

    await controller.enableUnifiedLogging({
      level: 'warn',
      contexts: ['background'],
      format: 'pretty',
      timestamps: true,
      color: true,
      urlFilter: 'foo',
      tabFilter: 7
    })
    expect(rdp.enableUnifiedLogging).toHaveBeenCalledWith({
      level: 'warn',
      contexts: ['background'],
      format: 'pretty',
      timestamps: true,
      color: true,
      urlFilter: 'foo',
      tabFilter: 7
    })
  })
})
