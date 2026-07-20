import {describe, expect, it} from 'vitest'
import {missingGeckoDataCollectionPermissions} from '../manifest-lib/gecko-data-collection'
import {UpdateManifest} from '../steps/update-manifest'

describe('missingGeckoDataCollectionPermissions', () => {
  it('is missing when browser_specific_settings is absent entirely', () => {
    expect(missingGeckoDataCollectionPermissions({name: 'x'} as any)).toBe(true)
  })

  it('is missing when gecko settings exist without the key', () => {
    expect(
      missingGeckoDataCollectionPermissions({
        name: 'x',
        browser_specific_settings: {gecko: {id: 'x@example.com'}}
      } as any)
    ).toBe(true)
  })

  it('is missing when the declaration is not an object', () => {
    expect(
      missingGeckoDataCollectionPermissions({
        name: 'x',
        browser_specific_settings: {
          gecko: {data_collection_permissions: 'none'}
        }
      } as any)
    ).toBe(true)
  })

  it('is satisfied by a required-none declaration', () => {
    expect(
      missingGeckoDataCollectionPermissions({
        name: 'x',
        browser_specific_settings: {
          gecko: {data_collection_permissions: {required: ['none']}}
        }
      } as any)
    ).toBe(false)
  })
})

describe('UpdateManifest AMO data-collection warning', () => {
  const make = (
    mode: 'development' | 'production',
    browser: string,
    manifestSource: string
  ) => {
    const assets: Record<string, any> = {
      'manifest.json': {source: () => manifestSource}
    }
    const compilation: any = {
      errors: [],
      warnings: [],
      options: {mode},
      assets,
      getAsset: (n: string) =>
        assets[n] ? {source: assets[n].source} : undefined,
      getAssets: () =>
        Object.entries(assets).map(([name, src]) => ({name, source: src})),
      hooks: {
        processAssets: {tap: (_opts: any, fn: any) => fn()}
      },
      updateAsset: () => {},
      emitAsset: () => {}
    }
    const compiler: any = {
      options: {mode},
      hooks: {
        thisCompilation: {tap: (_n: string, fn: any) => fn(compilation)}
      }
    }
    return {compiler, compilation, browser}
  }

  const run = (
    mode: 'development' | 'production',
    browser: string,
    manifest: object
  ) => {
    const {compiler, compilation} = make(
      mode,
      browser,
      JSON.stringify(manifest)
    )
    new UpdateManifest({manifestPath: '/m', browser: browser as any}).apply(
      compiler
    )
    return compilation.warnings as Array<Error & {name?: string}>
  }

  const bare = {name: 'x', version: '1.0.0', manifest_version: 2}

  it('warns on a production firefox build when the key is absent', () => {
    const warnings = run('production', 'firefox', bare)
    expect(warnings.some((w) => w.name === 'AmoDataCollectionWarning')).toBe(
      true
    )
  })

  it('stays quiet in development so watch recompiles do not repeat it', () => {
    const warnings = run('development', 'firefox', bare)
    expect(warnings.some((w) => w.name === 'AmoDataCollectionWarning')).toBe(
      false
    )
  })

  it('stays quiet for chromium targets, the key is AMO-only', () => {
    const warnings = run('production', 'chrome', {
      ...bare,
      manifest_version: 3
    })
    expect(warnings.some((w) => w.name === 'AmoDataCollectionWarning')).toBe(
      false
    )
  })

  it('stays quiet when the manifest declares the key', () => {
    const warnings = run('production', 'firefox', {
      ...bare,
      browser_specific_settings: {
        gecko: {data_collection_permissions: {required: ['none']}}
      }
    })
    expect(warnings.some((w) => w.name === 'AmoDataCollectionWarning')).toBe(
      false
    )
  })
})
