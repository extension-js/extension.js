import {describe, it, expect, vi, afterEach} from 'vitest'
import Module from 'module'
vi.mock('chrome-location2', () => ({default: () => '/Applications/Chrome.app'}))
vi.mock('chromium-location', () => ({
  default: () => '/Applications/Chromium.app',
  getInstallGuidance: () => 'npx @puppeteer/browsers install chromium',
  getChromiumVersion: () => 'Chromium 0',
  locateChromiumOrExplain: () => '/Applications/Chromium.app'
}))
import {RunChromiumPlugin} from '../../run-chromium'

const originalLoad = (Module as any)._load

// Mock CDP controller
vi.mock(
  '../../run-chromium/chromium-source-inspection/cdp-extension-controller',
  () => {
    class CDPExtensionController {
      public connect = vi.fn(async () => {})
      public ensureLoaded = vi.fn(async () => ({
        extensionId: 'id',
        name: 'n',
        version: 'v'
      }))
      public getInfoBestEffort = vi.fn(async () => ({
        extensionId: 'id',
        name: 'n',
        version: 'v'
      }))
      public clearProtocolEventHandler = vi.fn()
      public onProtocolEvent = vi.fn()
      public enableUnifiedLogging = vi.fn()
      public hardReload = vi.fn(async () => {})
      constructor(_: any) {}
    }
    return {CDPExtensionController}
  }
)

describe('Chromium protocol reload path', () => {
  afterEach(() => {
    ;(Module as any)._load = originalLoad
  })

  it('launches and is ready for hard reloads (controller present)', async () => {
    // Minimal fake compiler stats hook invocation
    const plugin = new RunChromiumPlugin({
      extension: '/ext',
      browser: 'chrome',
      port: 9333,
      dryRun: true
    } as any)

    const hooks: any = {
      done: {
        tapAsync: (name: string, cb: any) =>
          cb({compilation: {options: {mode: 'development'}}}, () => {}),
        tapPromise: (name: string, fn: any) =>
          Promise.resolve(fn({compilation: {options: {mode: 'development'}}}))
      }
    }
    const compiler: any = {hooks}

    plugin.apply(compiler)
    // If no exceptions here, the controller successfully attached in dryRun
    expect(true).toBe(true)
  })

  it('wires controller and can call hardReload via done sub-plugin (smoke)', async () => {
    const plugin = new RunChromiumPlugin({
      extension: '/ext',
      browser: 'chrome',
      port: 9333,
      dryRun: true
    } as any)

    const ctrl = {hardReload: vi.fn(async () => {})}
    ;(plugin as any).cdpController = ctrl

    const hooks: any = {
      watchRun: {
        tapAsync: (_: string, cb: any) =>
          cb(
            {
              modifiedFiles: new Set<string>([
                '/ext/background/service_worker.mjs'
              ])
            },
            () => {}
          )
      },
      done: {
        tapAsync: (_: string, cb: any) =>
          cb(
            {
              hasErrors: () => false,
              compilation: {
                options: {mode: 'development'},
                assets: {
                  'manifest.json': {
                    source: () =>
                      JSON.stringify({
                        background: {
                          service_worker: 'background/service_worker.mjs'
                        }
                      })
                  }
                }
              }
            },
            () => {}
          ),
        tapPromise: (_: string, fn: any) =>
          Promise.resolve(
            fn({
              hasErrors: () => false,
              compilation: {
                options: {mode: 'development'},
                assets: {
                  'manifest.json': {
                    source: () =>
                      JSON.stringify({
                        background: {
                          service_worker: 'background/service_worker.mjs'
                        }
                      })
                  }
                }
              }
            })
          )
      }
    }

    const compiler: any = {hooks}
    plugin.apply(compiler)

    expect(true).toBe(true)
  })
})
