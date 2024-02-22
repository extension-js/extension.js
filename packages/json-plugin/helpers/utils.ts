import path from 'path'
import {type Compilation} from 'webpack'
import {type Manifest} from '../types'

function shouldExclude(path: string, ignorePatterns: string[]): boolean {
  return ignorePatterns.some((pattern) => {
    return path.includes(pattern)
  })
}

function getExtname(filePath: string) {
  const extname = path.extname(filePath)

  switch (extname) {
    case '.js':
    case '.mjs':
    case '.ts':
    case '.tsx':
      return '.js'
    case '.css':
    case '.scss':
    case '.sass':
    case '.less':
      return '.css'
    case '.html':
      return '.html'
    default:
      return '.js'
  }
}

function getManifestContent(
  compilation: Compilation,
  manifestPath: string
): Manifest {
  if (compilation.getAsset('manifest.json')) {
    const manifest = compilation.assets['manifest.json'].source().toString()
    return JSON.parse(manifest || '{}')
  }

  return require(manifestPath)
}

export default {
  shouldExclude,
  getExtname,
  getManifestContent
}
