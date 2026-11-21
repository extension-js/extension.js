import {describe, expect, it} from 'vitest'
import {
  asCompilation,
  asCompiler,
  type TapCallback
} from '../../__spec__/helpers/rspack-fakes'
import {missingGeckoDataCollectionPermissions} from '../manifest-lib/gecko-data-collection'
import {UpdateManifest} from '../steps/update-manifest'
import {asBrowser, asManifest, type FakeSource} from './helpers/manifest-fakes'

describe('missingGeckoDataCollectionPermissions', () => {
  it('is missing when browser_specific_settings is absent entirely', () => {
    expect(missingGeckoDataCollectionPermissions(asManifest({name: 'x'}))).toBe(
      true
    )
  })

  it('is missing when gecko settings exist without the key', () => {
    expect(
      missingGeckoDataCollectionPermissions(
        asManifest({
          name: 'x',
          browser_specific_settings: {gecko: {id: 'x@example.com'}}
        })
      )
    ).toBe(true)
  })

  it('is missing when the declaration is not an object', () => {
    expect(
      missingGeckoDataCollectionPermissions(
        asManifest({
          name: 'x',
          browser_specific_settings: {
            gecko: {data_collection_permissions: 'none'}
          }
        })
      )
    ).toBe(true)
  })

  it('is satisfied by a required-none declaration', () => {
    expect(
      missingGeckoDataCollectionPermissions(
        asManifest({
          name: 'x',
          browser_specific_settings: {
            gecko: {data_collection_permissions: {required: ['none']}}
          }
        })
      )
    ).toBe(false)
  })
})

describe('UpdateManifest AMO data-collection warning', () => {
  const make = (
    mode: 'development' | 'production',
    browser: string,
    manifestSource: string,
    errors: Error[] = []
  ) => {
    const assets: Record<string, FakeSource> = {
      'manifest.json': {source: () => manifestSource}
    }
    const compilation = asCompilation({
      errors,
      warnings: [],
      options: {mode},
      assets,
      getAsset: (n: string) =>
        assets[n] ? {source: assets[n].source} : undefined,
      getAssets: () =>
        Object.entries(assets).map(([name, src]) => ({name, source: src})),
      hooks: {
        processAssets: {tap: (_opts: unknown, fn: TapCallback) => fn()}
      },
      updateAsset: () => {},
      emitAsset: () => {}
    })
    const compiler = asCompiler({
      options: {mode},
      hooks: {
        thisCompilation: {tap: (_n: string, fn: TapCallback) => fn(compilation)}
      }
    })

    return {compiler, compilation, browser}
  }

  const run = (
    mode: 'development' | 'production',
    browser: string,
    manifest: object | string,
    errors: Error[] = []
  ) => {
    const {compiler, compilation} = make(
      mode,
      browser,
      typeof manifest === 'string' ? manifest : JSON.stringify(manifest),
      errors
    )
    new UpdateManifest({manifestPath: '/m', browser: asBrowser(browser)}).apply(
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

  it('leaves the declaration to the owner and proposes no value', () => {
    const warnings = run('production', 'firefox', bare)
    const warning = warnings.find((w) => w.name === 'AmoDataCollectionWarning')
    // eslint-disable-next-line no-control-regex
    const text = String(warning?.message).replace(/\u001b\[[0-9;]*m/g, '')

    expect(text).toContain(
      'browser_specific_settings.gecko.data_collection_permissions'
    )

    expect(text).toContain("extension's owner")
    expect(text).toContain(
      'https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/'
    )

    expect(text).not.toMatch(/none/i)
    expect(text).not.toContain('required"')
    expect(text).not.toContain('{')
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

  describe('on a build that already failed', () => {
    const failed = () => [new Error("Can't resolve './missing-file.js'")]
    const amo = (warnings: Array<Error & {name?: string}>) =>
      warnings.filter((w) => w.name === 'AmoDataCollectionWarning')

    it('still warns a production firefox build once', () => {
      expect(amo(run('production', 'firefox', bare, failed()))).toHaveLength(1)
    })

    it('reads the vendor prefixed key of the target', () => {
      const declared = {
        ...bare,
        'firefox:browser_specific_settings': {
          gecko: {data_collection_permissions: {required: ['none']}}
        }
      }

      expect(amo(run('production', 'firefox', declared, failed()))).toEqual([])
    })

    it('stays quiet in development and for a chromium target', () => {
      expect(amo(run('development', 'firefox', bare, failed()))).toEqual([])
      expect(amo(run('production', 'chrome', bare, failed()))).toEqual([])
    })

    it('leaves a manifest that cannot be read to its own error', () => {
      expect(run('production', 'firefox', '{"name": ', failed())).toEqual([])
    })

    it('warns when the failure is a mistyped manifest field', () => {
      const mistyped = {...bare, content_scripts: 'everywhere'}

      expect(amo(run('production', 'firefox', mistyped))).toHaveLength(1)
    })
  })
})
