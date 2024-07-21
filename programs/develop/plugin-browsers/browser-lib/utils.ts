import {type Compilation} from 'webpack'

export function getManifestContent(
  compilation: Compilation,
  manifestPath: string
) {
  if (
    compilation.getAsset('manifest.json') ||
    compilation.assets['manifest.json']
  ) {
    const manifest = compilation.assets['manifest.json'].source().toString()
    return JSON.parse(manifest || '{}')
  }

  return require(manifestPath)
}
