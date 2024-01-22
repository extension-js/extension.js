import webpack from 'webpack'

export function handleMultipleAssetsError(
  error: webpack.WebpackError
): webpack.WebpackError | null {
  const actualMsg =
    'Conflict: Multiple assets emit different content to the same filename '
  if (error.message.includes(actualMsg)) {
    const filename = error.message.replace(actualMsg, '')
    const extFilename = filename.split('.').pop()
    const errorMsg = `[content_scripts] One of your \`${extFilename}\` file imports is also defined as a content_script in manifest.json. Remove the duplicate entry and try again.`

    if (filename.startsWith('content_scripts')) {
      return new webpack.WebpackError(errorMsg)
    }
  }
  return null
}

export function handleCantResolveError(
  error: webpack.WebpackError
): webpack.WebpackError | null {
  const cantResolveMsg = "Module not found: Error: Can't resolve"

  if (error.message.includes(cantResolveMsg)) {
    // Customize the error message or handle it as needed
    const customMessage = 'Custom Error Message: ' + error.message
    return new webpack.WebpackError(customMessage)
  }

  return null
}
