import * as path from 'path'
import {type FilepathList} from '../webpack-types'

export function isFromFilepathList(
  filePath: string,
  filepathList?: FilepathList
): boolean {
  return Object.values(filepathList || {}).some((value) => {
    return value === filePath
  })
}

export function getFilename(feature: string, filePath: string) {
  const entryExt = path.extname(filePath)

  let fileOutputpath = feature

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
