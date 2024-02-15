import {Compilation} from 'webpack'
import {Manifest} from '../types'

export function getManifestContent(
  compilation: Compilation,
  manifestPath: string
): Manifest {
  if (
    compilation.getAsset('manifest.json') ||
    compilation.assets['manifest.json']
  ) {
    const manifest = compilation.assets['manifest.json'].source().toString()
    return JSON.parse(manifest || '{}')
  }

  return require(manifestPath)
}
