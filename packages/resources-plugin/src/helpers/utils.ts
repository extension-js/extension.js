import {type Compilation} from 'webpack'
import {type Manifest} from '../../types'

function getManifestContent(
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

function shouldExclude(path: string, ignorePatterns: string[]): boolean {
  return ignorePatterns.some((pattern) => {
    return path.includes(pattern)
  })
}

export default {
  getManifestContent,
  shouldExclude
}
