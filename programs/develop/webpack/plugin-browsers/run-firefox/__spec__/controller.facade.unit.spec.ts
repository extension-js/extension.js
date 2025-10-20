import {describe, it, expect, vi} from 'vitest'
import {FirefoxRDPController} from '../rdp-extension-controller'

describe('FirefoxRDPController', () => {
  it('delegates to RemoteFirefox for ensureLoaded/hardReload/logging', async () => {
    const plugin = {
      extension: 'dist/firefox',
      browser: 'firefox'
    } as any
    const controller = new FirefoxRDPController(plugin, 9222)

    const remote = controller.getRemoteFirefox() as any
    remote.installAddons = vi.fn().mockResolvedValue(undefined)
    remote.enableUnifiedLogging = vi.fn().mockResolvedValue(undefined)
    remote.hardReloadIfNeeded = vi.fn().mockResolvedValue(undefined)

    const comp = {} as any
    await controller.ensureLoaded(comp)
    await controller.enableUnifiedLogging({level: 'info'})
    await controller.hardReload(comp, ['manifest.json'])

    expect(remote.installAddons).toHaveBeenCalledWith(comp)
    expect(remote.enableUnifiedLogging).toHaveBeenCalled()
    expect(remote.hardReloadIfNeeded).toHaveBeenCalledWith(comp, [
      'manifest.json'
    ])
  })
})
