import {describe, it, expect} from 'vitest'
import {UpdateManifest} from '../steps/update-manifest'

function runUpdateManifest(opts: {
  mode: 'development' | 'production'
  browser: 'chrome' | 'firefox'
  manifest: any
}) {
  const assets: Record<string, any> = {
    'manifest.json': {source: () => JSON.stringify(opts.manifest)}
  }
  const updated: Record<string, string> = {}
  const compilation: any = {
    errors: [],
    assets,
    getAsset: (n: string) =>
      assets[n] ? {source: assets[n].source} : undefined,
    hooks: {
      processAssets: {tap: (_opts: any, fn: any) => fn()}
    },
    updateAsset: (name: string, src: any) => {
      updated[name] = src.source().toString()
    }
  }
  const compiler: any = {
    options: {mode: opts.mode},
    hooks: {
      thisCompilation: {tap: (_n: string, fn: any) => fn(compilation)}
    }
  }

  new UpdateManifest({
    manifestPath: '/m',
    browser: opts.browser
  } as any).apply(compiler)

  return JSON.parse(updated['manifest.json'])
}

describe('UpdateManifest (browser-prefixed background keys)', () => {
  it('rewrites firefox: background scripts when using firefox:scripts', () => {
    const out = runUpdateManifest({
      mode: 'production',
      browser: 'firefox',
      manifest: {
        manifest_version: 2,
        name: 'x',
        version: '1.0.0',
        background: {
          'firefox:scripts': ['./src/background/main.ts'],
          'chromium:service_worker': './src/background/main.ts'
        }
      }
    })

    expect(out.background?.scripts).toEqual(['background/scripts.js'])
    expect(out.background?.service_worker).toBeUndefined()
  })

  it('rewrites chromium: background service worker when using chromium:service_worker', () => {
    const out = runUpdateManifest({
      mode: 'production',
      browser: 'chrome',
      manifest: {
        manifest_version: 3,
        name: 'x',
        version: '1.0.0',
        background: {
          'chromium:service_worker': './src/background/main.ts',
          'firefox:scripts': ['./src/background/main.ts']
        }
      }
    })

    expect(out.background?.service_worker).toBe('background/service_worker.js')
    expect(out.background?.scripts).toBeUndefined()
  })

  it('resolves MV3 side_panel.default_path to canonical output path', () => {
    const out = runUpdateManifest({
      mode: 'production',
      browser: 'chrome',
      manifest: {
        manifest_version: 3,
        name: 'x',
        version: '1.0.0',
        side_panel: {
          default_path: 'src/sidebar/index.html',
          default_title: 'Panel'
        }
      }
    })

    expect(out.side_panel?.default_path).toBe('sidebar/index.html')
    expect(out.side_panel?.default_title).toBe('Panel')
  })
})
