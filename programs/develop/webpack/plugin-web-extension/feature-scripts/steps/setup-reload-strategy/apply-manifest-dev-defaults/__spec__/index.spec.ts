import {describe, it, expect} from 'vitest'
import {Compilation} from '@rspack/core'
import {ApplyManifestDevDefaults} from '../index'

/**
 * Regression: ApplyManifestDevDefaults must run after REPORT-stage manifest patchers
 * (e.g. WAR patch) and after UpdateManifest (SUMMARIZE), so it is the final
 * manifest writer before browser launch.
 *
 * If it runs too early, a later hook can overwrite resolved paths and Chromium
 * may fail with errors like "Side panel file path must exist".
 */
describe('ApplyManifestDevDefaults', () => {
  it('registers processAssets after REPORT so it runs after WAR patching', () => {
    let capturedStage: number | undefined
    const minimalManifest = {manifest_version: 3, name: 'x'}
    const compilation = {
      errors: [],
      getAsset: (name: string) =>
        name === 'manifest.json'
          ? {source: () => JSON.stringify(minimalManifest)}
          : undefined,
      assets: {
        'manifest.json': {source: () => JSON.stringify(minimalManifest)}
      },
      updateAsset: () => {},
      hooks: {
        processAssets: {
          tap: (opts: {name: string; stage?: number}, fn: () => void) => {
            capturedStage = opts.stage
            fn()
          }
        }
      }
    } as unknown as Compilation

    const compiler = {
      hooks: {
        thisCompilation: {
          tap: (_name: string, fn: (c: Compilation) => void) => fn(compilation)
        }
      }
    } as any

    new ApplyManifestDevDefaults({
      manifestPath: '/m/manifest.json',
      browser: 'chrome'
    }).apply(compiler)

    expect(capturedStage).toBe(Compilation.PROCESS_ASSETS_STAGE_REPORT + 100)
  })

  it('preserves resolved manifest paths when asset already has them (no overwrite with source paths)', () => {
    const manifestWithResolvedPaths = {
      manifest_version: 3,
      name: 'x',
      version: '1.0.0',
      side_panel: {
        default_path: 'sidebar/index.html',
        default_title: 'Panel'
      },
      background: {
        service_worker: 'background/service_worker.js'
      }
    }

    let updatedManifestJson: string | undefined
    const compilation = {
      errors: [],
      getAsset: (name: string) =>
        name === 'manifest.json'
          ? {source: () => JSON.stringify(manifestWithResolvedPaths)}
          : undefined,
      assets: {
        'manifest.json': {
          source: () => JSON.stringify(manifestWithResolvedPaths)
        }
      },
      updateAsset: (name: string, rawSource: {source: () => string}) => {
        if (name === 'manifest.json') {
          updatedManifestJson = rawSource.source()
        }
      },
      hooks: {
        processAssets: {
          tap: (_opts: unknown, fn: () => void) => fn()
        }
      }
    } as unknown as Compilation

    const compiler = {
      hooks: {
        thisCompilation: {
          tap: (_name: string, fn: (c: Compilation) => void) => fn(compilation)
        }
      }
    } as any

    new ApplyManifestDevDefaults({
      manifestPath: '/m/manifest.json',
      browser: 'chrome'
    }).apply(compiler)

    expect(updatedManifestJson).toBeDefined()
    const out = JSON.parse(updatedManifestJson!)
    expect(out.side_panel?.default_path).toBe('sidebar/index.html')
    expect(out.background?.service_worker).toBe('background/service_worker.js')
  })
})
