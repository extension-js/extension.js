import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {trackTempFolders} from '../../../../__spec__/helpers/temp-folders'
import {
  getCurrentManifestContent,
  getManifestContent,
  getOriginalManifest,
  isStaticThemeCompilation,
  readManifestAssetText,
  setCurrentManifestContent,
  setOriginalManifestContent
} from '../manifest'

const makeTempFolder = trackTempFolders()

// A compilation as rspack hands it over: the assets can be read back.
function compilationWith(manifest?: Record<string, unknown>) {
  const assets = new Map<string, string>()
  if (manifest) assets.set('manifest.json', JSON.stringify(manifest))

  const compilation = {
    getAsset: (name: string) =>
      assets.has(name)
        ? {source: {source: () => assets.get(name) as string}}
        : undefined
  }

  return {compilation: compilation as never, assets}
}

describe('reading the manifest of a compilation', () => {
  it('reads the asset, whoever wrote it last', () => {
    const {compilation, assets} = compilationWith({name: 'emitted'})
    setOriginalManifestContent(compilation, JSON.stringify({name: 'authored'}))
    setCurrentManifestContent(compilation, JSON.stringify({name: 'handed'}))

    expect(getManifestContent(compilation, '/nowhere/manifest.json')).toEqual({
      name: 'emitted'
    })

    // What a plugin of the project does between two built-in steps.
    assets.set('manifest.json', JSON.stringify({name: 'edited by the project'}))

    expect(getManifestContent(compilation, '/nowhere/manifest.json')).toEqual({
      name: 'edited by the project'
    })

    expect(readManifestAssetText(compilation)).toBe(
      '{"name":"edited by the project"}'
    )

    expect(getCurrentManifestContent(compilation)).toBe(
      '{"name":"edited by the project"}'
    )
  })

  it('falls back to the authored manifest, then to the file, when no asset exists', () => {
    const {compilation} = compilationWith()
    const folder = makeTempFolder('manifest-asset-first-')
    const manifestPath = path.join(folder, 'manifest.json')
    fs.writeFileSync(manifestPath, JSON.stringify({name: 'on disk'}))

    expect(getManifestContent(compilation, manifestPath)).toEqual({
      name: 'on disk'
    })

    setOriginalManifestContent(compilation, JSON.stringify({name: 'authored'}))

    expect(getManifestContent(compilation, manifestPath)).toEqual({
      name: 'authored'
    })

    expect(readManifestAssetText(compilation)).toBeUndefined()
    expect(getCurrentManifestContent(compilation)).toBeUndefined()
  })

  it('answers from the handed-over text only when the assets cannot be read back', () => {
    const double = {} as never
    setCurrentManifestContent(double, '{"name":"handed"}')

    expect(getCurrentManifestContent(double)).toBe('{"name":"handed"}')
  })

  it('parses the authored manifest once for every check that reads it', () => {
    const {compilation} = compilationWith()

    expect(getOriginalManifest(compilation)).toBeUndefined()

    setOriginalManifestContent(compilation, JSON.stringify({name: 'authored'}))
    const first = getOriginalManifest(compilation)

    expect(first).toEqual({name: 'authored'})
    expect(getOriginalManifest(compilation)).toBe(first)

    // A new build of the same compilation object starts from its own text.
    setOriginalManifestContent(compilation, JSON.stringify({name: 'again'}))

    expect(getOriginalManifest(compilation)).toEqual({name: 'again'})
  })
})

describe('telling a static theme from the compilation', () => {
  const theme = {manifest_version: 3, name: 't', theme: {colors: {}}}

  it('decides from the authored manifest and never opens the file', () => {
    const {compilation} = compilationWith()
    setOriginalManifestContent(compilation, JSON.stringify(theme))

    expect(
      isStaticThemeCompilation(compilation, '/nowhere/manifest.json', 'chrome')
    ).toBe(true)

    setOriginalManifestContent(
      compilation,
      JSON.stringify({...theme, background: {service_worker: 'bg.js'}})
    )

    expect(
      isStaticThemeCompilation(compilation, '/nowhere/manifest.json', 'chrome')
    ).toBe(false)
  })

  it('resolves browser prefixes before it decides', () => {
    const {compilation} = compilationWith()
    setOriginalManifestContent(
      compilation,
      JSON.stringify({...theme, 'firefox:background': {scripts: ['bg.js']}})
    )

    expect(isStaticThemeCompilation(compilation, undefined, 'chrome')).toBe(
      true
    )

    expect(isStaticThemeCompilation(compilation, undefined, 'firefox')).toBe(
      false
    )
  })

  it('reads the file only when no step recorded a manifest', () => {
    const {compilation} = compilationWith()
    const folder = makeTempFolder('manifest-static-theme-')
    const manifestPath = path.join(folder, 'manifest.json')
    fs.writeFileSync(manifestPath, JSON.stringify(theme))

    expect(isStaticThemeCompilation(compilation, manifestPath, 'chrome')).toBe(
      true
    )

    expect(isStaticThemeCompilation(compilation, undefined, 'chrome')).toBe(
      false
    )
  })
})
