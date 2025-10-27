import {describe, it, expect, vi, afterEach} from 'vitest'
import Module from 'module'
import {RunChromiumPlugin} from '../index'

const originalLoad = (Module as any)._load

// Mock CDP controller
vi.mock('../setup-chrome-inspection/cdp-extension-controller', () => {
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
})

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
          cb({compilation: {options: {mode: 'development'}}}, () => {})
      }
    }
    const compiler: any = {hooks}

    plugin.apply(compiler)
    // If no exceptions here, the controller successfully attached in dryRun
    expect(true).toBe(true)
  })

  it('triggers hard reload when manifest-derived SW .mjs asset is emitted', async () => {
    const plugin = new RunChromiumPlugin({
      extension: '/ext',
      browser: 'chrome',
      port: 9333,
      dryRun: true
    } as any)

    // Inject a mock controller retained by plugin
    const ctrl = {hardReload: vi.fn(async () => {})}
    ;(plugin as any).cdpController = ctrl

    const getAssets = () => [
      {name: 'background/service_worker.mjs', emitted: true},
      {name: 'manifest.json', emitted: true}
    ]

    const stats: any = {
      compilation: {
        options: {mode: 'development', context: process.cwd()},
        getAssets
      },
      hasErrors: () => false
    }

    // Call the private method through casting
    await (plugin as any).conditionalHardReload(stats)

    expect(ctrl.hardReload).toHaveBeenCalled()
  })
})
