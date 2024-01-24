import webpack from 'webpack'
import resolvePath from './resolver'

// Example utility function
export function logMessage(message: string): void {
  console.log(message)
}

export function isUrl(path: string) {
  try {
    new URL(path)
    return true
  } catch (_) {
    return false
  }
}

export function isPublicPath(context: string, path: string) {
  const resultResolvedPath = resolvePath(context, path)
  return resultResolvedPath.startsWith('/public')
}

export function isPagesPath(context: string, path: string) {
  const resultResolvedPath = resolvePath(context, path)
  return resultResolvedPath.startsWith('/pages')
}

export function errorMessage(
  resultAbsolutePath: string,
  result: {path: string},
  resourcePath: string
) {
  return new webpack.WebpackError(
    `\nFile path ${resultAbsolutePath} not found. ` +
      `Check the request for ${result.path} in ${resourcePath}.`
  )
}
