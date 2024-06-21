import {type Compilation} from 'webpack'
import {type Manifest} from '../types'

/**
 * Change the path from win style to unix style
 */
function unixify(path: string) {
  return path.replace(/\\/g, '/');
}

function shouldExclude(path: string, ignorePatterns: string[]): boolean {
  return ignorePatterns.some((pattern) => {
    const _pattern = unixify(pattern)
    return path.includes(_pattern.startsWith('/') ? _pattern.slice(1) : _pattern)
  })
}

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

export default {
  unixify,
  shouldExclude,
  getManifestContent
}
