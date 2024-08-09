import webpack from 'webpack'
import * as messages from '../../lib/messages'

export function handleMultipleAssetsError(
  packageJsonPath: string,
  error: webpack.WebpackError
): webpack.WebpackError | null {
  const actualMsg =
    'Conflict: Multiple assets emit different content to the same filename '
  if (error.message.includes(actualMsg)) {
    const filename = error.message.replace(actualMsg, '')

    if (filename.startsWith('content_scripts')) {
      return new webpack.WebpackError(
        messages.handleMultipleAssetsError(packageJsonPath, filename)
      )
    }
  }
  return null
}

export function handleCantResolveError(
  packageJsonPath: string,
  error: webpack.WebpackError
): webpack.WebpackError | null {
  const manifest = require(packageJsonPath)
  const cantResolveMsg = 'Module not found: Error:'

  if (error.message.includes(cantResolveMsg)) {
    const noPrefixMsg = error.message.replace(cantResolveMsg, '')
    // Error message comes into the format
    // Module not found: Error: Can't resolve 'dep' in 'dep_path'.
    // We just want the 'dep' part.
    const moduleName = noPrefixMsg.split("'")[2]
    return new webpack.WebpackError(
      messages.handleCantResolveError(manifest.name, moduleName)
    )
  }

  return null
}

export function handleTopLevelAwaitError(
  packageJsonPath: string,
  error: webpack.WebpackError
): webpack.WebpackError | null {
  const manifest = require(packageJsonPath)
  const topLevelAwaitMsg =
    'Top-level-await is only supported in EcmaScript Modules'

  if (error.message.includes(topLevelAwaitMsg)) {
    return new webpack.WebpackError(
      messages.handleTopLevelAwaitError(manifest.name)
    )
  }

  return null
}
