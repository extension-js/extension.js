import * as path from 'path'
import {type FilepathList} from '../webpack-types'

export function getResolvedPath(
  context: string,
  filePath: string,
  basePath: string
) {
  // Ensure the filePath is relative to the context
  const relativePath = path.relative(context, filePath)

  // Normalize to avoid issues with different OS path formats
  const pathNormalized = path.normalize(relativePath)
  const prefixedBasePath = basePath ? `/${basePath}` : ''
  const publicPath = path.join(prefixedBasePath, pathNormalized)

  return path.normalize(publicPath)
}

export function isFromFilepathList(
  filePath: string,
  filepathList?: FilepathList
): boolean {
  return Object.values(filepathList || {}).some((value) => {
    return value === filePath
  })
}

export function getFilename(
  feature: string,
  filePath: string,
  excludeList: FilepathList
) {
  const entryExt = path.extname(filePath)

  // Do not attempt to rewrite the asset path if it's in the exclude list.
  const skipPathResolve = shouldExclude(filePath, excludeList)

  let fileOutputpath = skipPathResolve ? path.normalize(filePath) : feature

  // If excluded and the excluded path comes from a special folder mapping
  // (e.g., public/), derive the output from the mapping key so manifest paths
  // match where SpecialFolders are copied to at build time.
  if (skipPathResolve) {
    const matched = Object.entries(excludeList || {}).find(([, value]) => {
      if (Array.isArray(value)) return value.includes(filePath)
      return value === filePath
    })

    const matchedKey = matched?.[0]
    if (matchedKey && typeof matchedKey === 'string') {
      const unixKey = unixify(matchedKey)
      // Only remap when the mapping key represents a public/ path
      if (/^(?:\.\/)?public\//i.test(unixKey)) {
        fileOutputpath = unixKey.replace(/^(?:\.\/)?public\//i, '')
      } else if (/^\/public\//i.test(unixKey)) {
        fileOutputpath = unixKey.replace(/^\/public\//i, '')
      } else if (/^\//.test(unixKey)) {
        // Root-relative (implicit public root)
        fileOutputpath = unixKey.replace(/^\//, '')
      } else {
        // Keep original normalized file path for non-public mapping keys
        fileOutputpath = path.normalize(filePath)
      }
    }
  }

  // Not excluded by value; try to derive from mapping keys when the manifest
  // provided a public-root style path and we have a matching entry from
  // SpecialFolders. This accounts for different authoring forms:
  // 'public/foo', './public/foo', '/public/foo', or '/foo'.
  if (!skipPathResolve && excludeList) {
    const keys = Object.keys(excludeList)
    const unixInput = unixify(filePath)

    // First try exact key match
    let matchKey = keys.find((k) => unixify(k) === unixInput)

    // If not found, try a normalized public-root equivalence match
    if (!matchKey) {
      const stripPublicPrefix = (p: string) =>
        unixify(p)
          .replace(/^\/(?:public\/)?/i, '') // '/public/foo' or '/foo' -> 'foo'
          .replace(/^(?:\.\/)?public\//i, '') // 'public/foo' or './public/foo' -> 'foo'

      const inputStripped = stripPublicPrefix(unixInput)
      matchKey = keys.find((k) => stripPublicPrefix(k) === inputStripped)
    }

    if (matchKey) {
      const unixKey = unixify(matchKey)
      if (/^(?:\.\/)?public\//i.test(unixKey)) {
        fileOutputpath = unixKey.replace(/^(?:\.\/)?public\//i, '')
      } else if (/^\/public\//i.test(unixKey)) {
        fileOutputpath = unixKey.replace(/^\/public\//i, '')
      } else {
        fileOutputpath = unixKey
      }
    }
  }

  if (['.js', '.jsx', '.tsx', '.ts'].includes(entryExt)) {
    fileOutputpath = fileOutputpath.replace(entryExt, '.js')
  }

  if (['.html', '.njk', '.nunjucks'].includes(entryExt)) {
    fileOutputpath = fileOutputpath.replace(entryExt, '.html')
  }

  if (['.css', '.scss', '.sass', '.less'].includes(entryExt)) {
    fileOutputpath = fileOutputpath.replace(entryExt, '.css')
  }

  return unixify(fileOutputpath || '')
}

/**
 * Change the path from win style to unix style
 */
export function unixify(filePath: string) {
  return filePath.replace(/\\/g, '/')
}

export function shouldExclude(
  filePath: string,
  ignorePatterns: FilepathList = {}
): boolean {
  if (!ignorePatterns) {
    return false
  }

  const unixifiedFilePath = path.normalize(unixify(filePath))
  const isFilePathInExcludedList = Object.values(ignorePatterns).some(
    (pattern) => {
      const matchOne = (candidate: string) => {
        if (!candidate || typeof candidate !== 'string') return false
        const normalizedCandidate = path.normalize(unixify(candidate))
        // Consider a match if the file path is exactly the same or contained under the candidate path
        return (
          unixifiedFilePath === normalizedCandidate ||
          unixifiedFilePath.startsWith(normalizedCandidate)
        )
      }

      if (Array.isArray(pattern)) {
        return pattern.some((p) => matchOne(p as any))
      }

      return matchOne(pattern as any)
    }
  )

  return isFilePathInExcludedList
}

export function getRelativePath(from: string, to: string) {
  let relativePath = path.relative(path.dirname(from), to)
  if (!relativePath.startsWith('.') && !relativePath.startsWith('..')) {
    relativePath = './' + relativePath
  }
  return relativePath
}
