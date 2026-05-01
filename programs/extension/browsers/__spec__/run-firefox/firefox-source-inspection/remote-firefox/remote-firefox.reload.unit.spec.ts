import {describe, it, expect, vi, beforeEach} from 'vitest'
import {RemoteFirefox} from '../../../../run-firefox/firefox-source-inspection/remote-firefox'

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

  it('treats project-root _locales edits as critical', async () => {
    // Platform-standard layout puts _locales/ at the project root (no src/).
    // The Firefox path detector must recognize this shape — otherwise locale
    // edits silently no-op on Firefox even though Chromium reloads fine.
    const rf = new RemoteFirefox({
      extension: 'dist/firefox',
      browser: 'firefox'
    } as any)

    const client = {
      request: vi
        .fn()
        .mockResolvedValueOnce({
          types: ['installTemporaryAddon', 'reloadAddon']
        })
        .mockResolvedValueOnce({ok: true})
    }

    ;(rf as any).client = client
    ;(rf as any).cachedAddonsActor = 'addonsActor'
    ;(rf as any).lastInstalledAddonPath = '/abs/addon'
    ;(rf as any).cachedSupportsReload = null

    const compilation = makeCompilationWithManifest({default_locale: 'en'})
    await rf.hardReloadIfNeeded(compilation, ['_locales/en/messages.json'])

    expect(client.request).toHaveBeenCalledWith({
      to: 'addonsActor',
      type: 'reloadAddon'
    })
  })

  it('treats project-relative manifest/SW paths as critical (src/ prefix)', async () => {
    // BrowsersPlugin emits paths relative to the user's project context
    // (e.g. src/manifest.json, src/background.js), not the dist root.
    // Older versions used Array.includes(exactString) which silently
    // rejected the prefixed paths and skipped the reload entirely.
    const rf = new RemoteFirefox({
      extension: 'dist/firefox',
      browser: 'firefox'
    } as any)

    const client = {
      request: vi
        .fn()
        .mockResolvedValueOnce({
          types: ['installTemporaryAddon', 'reloadAddon']
        })
        .mockResolvedValueOnce({ok: true})
    }

    ;(rf as any).client = client
    ;(rf as any).cachedAddonsActor = 'addonsActor'
    ;(rf as any).lastInstalledAddonPath = '/abs/addon'
    ;(rf as any).cachedSupportsReload = null

    const compilation = makeCompilationWithManifest({
      background: {service_worker: 'background.js'}
    })
    await rf.hardReloadIfNeeded(compilation, [
      'src/manifest.json',
      'src/background.js'
    ])

    expect(client.request).toHaveBeenCalledWith({
      to: 'addonsActor',
      type: 'reloadAddon'
    })
  })

  it('reloads only tabs matching affected content script rules', async () => {
    const rf = new RemoteFirefox({
      extension: 'dist/firefox',
      browser: 'firefox'
    } as any)

    const client = {
      getTargets: vi.fn(async () => [
        {
          actor: 'tab-1',
          consoleActor: 'console-1',
          url: 'https://docs.example.com/page'
        },
        {
          actor: 'tab-2',
          consoleActor: 'console-2',
          url: 'https://other.test/page'
        }
      ]),
      navigate: vi.fn(async () => {}),
      waitForLoadEvent: vi.fn(async () => {}),
      navigateViaScript: vi.fn(async () => {})
    }

    ;(rf as any).client = client

    const reloaded = await rf.reloadMatchingTabsForContentScripts([
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
    expect(client.navigate).toHaveBeenCalledWith(
      'tab-1',
      'https://docs.example.com/page'
    )
    expect(client.navigate).not.toHaveBeenCalledWith(
      'tab-2',
      'https://other.test/page'
    )
  })
})
