import {describe, it, expect, vi, beforeEach} from 'vitest'
import {RemoteFirefox} from '../index'

function makeCompilationWithManifest(manifest: unknown) {
  return {
    options: {devServer: {port: 8080}},
    getAsset: (name: string) =>
      name === 'manifest.json'
        ? ({
            source: {
              source: () => JSON.stringify(manifest)
            }
          } as any)
        : undefined
  } as unknown as import('@rspack/core').Compilation
}

describe('RemoteFirefox hardReloadIfNeeded', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('uses native reload when capability is present', async () => {
    const rf = new RemoteFirefox({
      extension: 'dist/firefox',
      browser: 'firefox'
    } as any)

    const client = {
      request: vi
        .fn()
        // requestTypes
        .mockResolvedValueOnce({
          types: ['installTemporaryAddon', 'reloadAddon']
        })
        // reloadAddon
        .mockResolvedValueOnce({ok: true})
    }

    ;(rf as any).client = client
    ;(rf as any).cachedAddonsActor = 'addonsActor'
    ;(rf as any).lastInstalledAddonPath = '/abs/addon'
    ;(rf as any).cachedSupportsReload = null

    const compilation = makeCompilationWithManifest({
      background: {service_worker: 'background/service_worker.js'}
    })
    await rf.hardReloadIfNeeded(compilation, ['background/service_worker.js'])

    expect(client.request).toHaveBeenCalledWith({
      to: 'addonsActor',
      type: 'requestTypes'
    })
    expect(client.request).toHaveBeenCalledWith({
      to: 'addonsActor',
      type: 'reloadAddon'
    })
  })

  it('falls back to reinstall when reload capability is missing', async () => {
    const rf = new RemoteFirefox({
      extension: 'dist/firefox',
      browser: 'firefox'
    } as any)

    const client = {
      request: vi
        .fn()
        // requestTypes without reload
        .mockResolvedValueOnce({types: ['installTemporaryAddon']})
        // reinstall
        .mockResolvedValueOnce({ok: true})
    }

    ;(rf as any).client = client
    ;(rf as any).cachedAddonsActor = 'addonsActor'
    ;(rf as any).lastInstalledAddonPath = '/abs/addon'
    ;(rf as any).cachedSupportsReload = null

    const compilation2 = makeCompilationWithManifest({name: 'x'})
    await rf.hardReloadIfNeeded(compilation2, ['manifest.json'])

    expect(client.request).toHaveBeenCalledWith({
      to: 'addonsActor',
      type: 'requestTypes'
    })
    expect(client.request).toHaveBeenCalledWith({
      to: 'addonsActor',
      type: 'installTemporaryAddon',
      addonPath: '/abs/addon',
      openDevTools: false
    })
  })
})
