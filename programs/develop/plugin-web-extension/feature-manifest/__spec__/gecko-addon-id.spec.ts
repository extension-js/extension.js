import {describe, expect, it} from 'vitest'
import {readGeckoManifestId} from '../../../lib/extension-id'
import {UpdateManifest} from '../steps/update-manifest'

type Warning = Error & {name?: string; file?: string}

function compile(
  plugin: UpdateManifest,
  mode: 'development' | 'production',
  manifest: object
) {
  const source = JSON.stringify(manifest)
  let emitted = ''
  const assets: Record<string, any> = {
    'manifest.json': {source: () => source}
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
    hooks: {processAssets: {tap: (_opts: any, fn: any) => fn()}},
    updateAsset: (_n: string, raw: {source: () => string}) => {
      emitted = String(raw.source())
    },
    emitAsset: (_n: string, raw: {source: () => string}) => {
      emitted = String(raw.source())
    }
  }
  const compiler: any = {
    options: {mode},
    hooks: {thisCompilation: {tap: (_n: string, fn: any) => fn(compilation)}}
  }
  plugin.apply(compiler)

  const warnings = compilation.warnings as Warning[]

  return {
    idWarnings: warnings.filter((w) => w.name === 'GeckoAddonIdWarning'),
    warnings,
    emitted: JSON.parse(emitted)
  }
}

const plugin = (browser: string) =>
  new UpdateManifest({manifestPath: '/m', browser: browser as any})

const mv3 = {name: 'x', version: '1.0.0', manifest_version: 3}
const mv2 = {name: 'x', version: '1.0.0', manifest_version: 2}

describe('readGeckoManifestId', () => {
  it('reads browser_specific_settings.gecko.id', () => {
    expect(
      readGeckoManifestId({
        browser_specific_settings: {gecko: {id: ' a@example.com '}}
      })
    ).toEqual({declared: ' a@example.com ', valid: 'a@example.com'})
  })

  it('reads the Manifest V2 applications.gecko.id', () => {
    expect(
      readGeckoManifestId({applications: {gecko: {id: 'a@example.com'}}}).valid
    ).toBe('a@example.com')
  })

  it('falls back to applications when browser_specific_settings has no id', () => {
    expect(
      readGeckoManifestId({
        browser_specific_settings: {gecko: {strict_min_version: '115.0'}},
        applications: {gecko: {id: '{12345678-1234-1234-1234-123456789abc}'}}
      }).valid
    ).toBe('{12345678-1234-1234-1234-123456789abc}')
  })

  it('keeps a refused shape as declared but not valid', () => {
    expect(
      readGeckoManifestId({browser_specific_settings: {gecko: {id: 'nope'}}})
    ).toEqual({declared: 'nope'})
  })

  it('reports nothing declared on a bare manifest', () => {
    expect(readGeckoManifestId({})).toEqual({declared: undefined})
  })
})

describe('UpdateManifest missing add-on ID warning', () => {
  it('warns on a Firefox build with no ID, says what breaks and how to set it', () => {
    const {idWarnings, emitted} = compile(plugin('firefox'), 'production', mv3)

    expect(idWarnings).toHaveLength(1)
    expect(idWarnings[0].file).toBe('manifest.json')
    const text = idWarnings[0].message
    expect(text).toContain('storage does not survive a relaunch')
    expect(text).toContain('addons.mozilla.org assigns one')
    expect(text).toContain('firefox:browser_specific_settings.gecko.id')
    expect(text).toContain('my-extension@example.com')
    // No ID is written for the author.
    expect(emitted.browser_specific_settings).toBeUndefined()
  })

  it('names a refused ID shape', () => {
    const {idWarnings, emitted} = compile(plugin('firefox'), 'production', {
      ...mv3,
      browser_specific_settings: {gecko: {id: 'not an id'}}
    })

    expect(idWarnings).toHaveLength(1)
    expect(idWarnings[0].message).toContain('"not an id"')
    expect(emitted.browser_specific_settings.gecko.id).toBe('not an id')
  })

  it('stays quiet when the ID is valid', () => {
    const {idWarnings} = compile(plugin('firefox'), 'production', {
      ...mv3,
      browser_specific_settings: {gecko: {id: 'my-extension@example.com'}}
    })

    expect(idWarnings).toHaveLength(0)
  })

  it('accepts the Manifest V2 applications.gecko.id', () => {
    const {idWarnings} = compile(plugin('firefox'), 'production', {
      ...mv2,
      applications: {gecko: {id: 'my-extension@example.com'}}
    })

    expect(idWarnings).toHaveLength(0)
  })

  it('covers every Gecko-based target', () => {
    expect(
      compile(plugin('gecko-based'), 'production', mv3).idWarnings
    ).toHaveLength(1)
  })

  it('stays quiet for Chromium targets', () => {
    expect(
      compile(plugin('chrome'), 'production', mv3).idWarnings
    ).toHaveLength(0)

    expect(
      compile(plugin('chromium-based'), 'development', mv3).idWarnings
    ).toHaveLength(0)
  })

  it('warns once per dev session, not on every rebuild', () => {
    const session = plugin('firefox')

    expect(compile(session, 'development', mv3).idWarnings).toHaveLength(1)
    expect(compile(session, 'development', mv3).idWarnings).toHaveLength(0)
    expect(compile(session, 'development', mv3).idWarnings).toHaveLength(0)
  })

  it('is a separate warning from the data declaration one', () => {
    const {warnings, idWarnings} = compile(plugin('firefox'), 'production', mv3)
    const data = warnings.filter((w) => w.name === 'AmoDataCollectionWarning')

    expect(data).toHaveLength(1)
    expect(idWarnings).toHaveLength(1)
    expect(data[0].message).not.toContain('gecko.id')
    expect(idWarnings[0].message).not.toContain('data_collection_permissions')
    expect(idWarnings[0].message).not.toContain('"required"')
  })
})
