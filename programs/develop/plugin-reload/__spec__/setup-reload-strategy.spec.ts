import {beforeEach, describe, expect, it, vi} from 'vitest'

// Captured constructor arguments, so we can assert what SetupReloadStrategy
// hands to the webextension target without running a real compilation.
const captured = vi.hoisted(() => ({
  webExtension: [] as any[],
  backgroundEntry: [] as any[]
}))

vi.mock('fs', () => ({
  readFileSync: vi.fn(() => JSON.stringify(currentManifest))
}))

vi.mock('../steps/setup-reload-strategy/setup-background-entry', () => ({
  SetupBackgroundEntry: class {
    constructor(options: any) {
      captured.backgroundEntry.push(options)
    }
    apply() {}
  }
}))

vi.mock(
  '../steps/setup-reload-strategy/webpack-target-webextension-fork',
  () => ({
    default: class {
      constructor(options: any) {
        captured.webExtension.push(options)
      }
      apply() {}
    }
  })
)

let currentManifest: any = {}

const {SetupReloadStrategy} = await import(
  '../steps/setup-reload-strategy/index'
)

function run(manifest: any, browser = 'chrome') {
  currentManifest = manifest
  captured.webExtension.length = 0
  captured.backgroundEntry.length = 0
  new SetupReloadStrategy({
    manifestPath: '/project/manifest.json',
    browser
  } as any).apply({} as any)
  return captured.webExtension[0]
}

describe('SetupReloadStrategy background entry', () => {
  beforeEach(() => {
    currentManifest = {}
  })

  it('uses a service worker entry for MV3 on chromium', () => {
    const opts = run({
      manifest_version: 3,
      background: {service_worker: 'b.js'}
    })
    expect(opts.background).toEqual({
      serviceWorkerEntry: 'background/service_worker',
      tryCatchWrapper: true,
      eagerChunkLoading: false
    })
  })

  it('uses a page entry for MV2 on chromium', () => {
    const opts = run({manifest_version: 2, background: {scripts: ['b.js']}})
    expect(opts.background.pageEntry).toBe('background/script')
    expect(opts.background.serviceWorkerEntry).toBeUndefined()
  })

  it('uses a page entry on gecko even when the manifest is MV3', () => {
    // Firefox runs an event page, not a service worker, so an MV3 manifest
    // must still resolve to a page entry.
    const opts = run(
      {manifest_version: 3, background: {service_worker: 'b.js'}},
      'firefox'
    )
    expect(opts.background.pageEntry).toBe('background/script')
    expect(opts.background.serviceWorkerEntry).toBeUndefined()
  })

  it('falls back to a plain background entry when the manifest declares none', () => {
    const opts = run({manifest_version: 3})
    expect(opts.background.pageEntry).toBe('background')
  })
})

describe('SetupReloadStrategy content script metadata', () => {
  it('is empty when the manifest declares no content scripts', () => {
    expect(run({manifest_version: 3}).contentScriptsMeta).toEqual({})
  })

  it('maps each ordinary content script to the extension world', () => {
    const meta = run({
      manifest_version: 3,
      content_scripts: [{matches: ['<all_urls>']}, {matches: ['<all_urls>']}]
    }).contentScriptsMeta

    expect(meta['content_scripts/content-0.js']).toEqual({
      index: 0,
      bundleId: 'content_scripts/content-0.js',
      world: 'extension'
    })
    expect(meta['content_scripts/content-1.js'].index).toBe(1)
  })

  it('pairs a MAIN world script with a bridge indexed past the original count', () => {
    const meta = run({
      manifest_version: 3,
      content_scripts: [
        {matches: ['<all_urls>'], world: 'MAIN'},
        {matches: ['<all_urls>']}
      ]
    }).contentScriptsMeta

    // The MAIN script keeps index 0 and points at its bridge.
    expect(meta['content_scripts/content-0.js']).toEqual({
      index: 0,
      bundleId: 'content_scripts/content-0.js',
      world: 'main',
      bridgeBundleId: 'content_scripts/content-2.js'
    })
    // The bridge is appended after the declared scripts, never overwriting
    // the ordinary script that already owns index 1.
    expect(meta['content_scripts/content-2.js']).toEqual({
      index: 2,
      bundleId: 'content_scripts/content-2.js',
      world: 'extension',
      role: 'main_world_bridge',
      mainBundleId: 'content_scripts/content-0.js'
    })
    expect(meta['content_scripts/content-1.js'].world).toBe('extension')
  })

  it('gives each MAIN world script its own bridge', () => {
    const meta = run({
      manifest_version: 3,
      content_scripts: [
        {matches: ['<all_urls>'], world: 'MAIN'},
        {matches: ['<all_urls>'], world: 'MAIN'}
      ]
    }).contentScriptsMeta

    expect(meta['content_scripts/content-0.js'].bridgeBundleId).toBe(
      'content_scripts/content-2.js'
    )
    expect(meta['content_scripts/content-1.js'].bridgeBundleId).toBe(
      'content_scripts/content-3.js'
    )
    expect(meta['content_scripts/content-3.js'].mainBundleId).toBe(
      'content_scripts/content-1.js'
    )
  })

  it('survives a malformed content_scripts value instead of failing the build', () => {
    const opts = run({manifest_version: 3, content_scripts: 'not-an-array'})
    expect(opts.contentScriptsMeta).toEqual({})
  })
})

describe('SetupReloadStrategy wiring', () => {
  it('forwards the manifest path and browser to the background entry step', () => {
    run({manifest_version: 3}, 'edge')
    expect(captured.backgroundEntry[0]).toEqual({
      manifestPath: '/project/manifest.json',
      browser: 'edge'
    })
  })

  it('defaults the browser to chrome', () => {
    currentManifest = {manifest_version: 3}
    captured.backgroundEntry.length = 0
    new SetupReloadStrategy({
      manifestPath: '/project/manifest.json'
    } as any).apply({} as any)
    expect(captured.backgroundEntry[0].browser).toBe('chrome')
  })
})
