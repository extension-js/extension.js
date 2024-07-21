import webpack from 'webpack'
import {bold, red, underline, blue} from '@colors/colors/safe'

export function handleMultipleAssetsError(
  manifestPath: string,
  error: webpack.WebpackError
): webpack.WebpackError | null {
  const manifest = require(manifestPath)
  const actualMsg =
    'Conflict: Multiple assets emit different content to the same filename '
  if (error.message.includes(actualMsg)) {
    const filename = error.message.replace(actualMsg, '')
    const extFilename = filename.split('.').pop()
    const errorMsg = `[${manifest.name}'s content_scripts] One of your \`${extFilename}\` file imports is also defined as a content_script in manifest.json. Remove the duplicate entry and try again.`

    if (filename.startsWith('content_scripts')) {
      return new webpack.WebpackError(errorMsg)
    }
  }
  return null
}

export function handleCantResolveError(
  manifestPath: string,
  error: webpack.WebpackError
): webpack.WebpackError | null {
  const manifest = require(manifestPath)
  const cantResolveMsg = 'Module not found: Error:'

  if (error.message.includes(cantResolveMsg)) {
    const link = 'https://extension.js.org/n/features/special-folders'
    const customMessage =
      `[${manifest.name}]:${error.message.replace(cantResolveMsg, '')}. ` +
      `Make sure to import the file correctly and that it exists in your extension's directory.` +
      `\n\nIf you need to handle assets not supported by ${underline(
        'manifest.json'
      )}, add them to the ` +
      `${underline('public/')} (for static content) or ${underline(
        'scripts/'
      )} folder. ` +
      `Read more about ${'special folders'} ${underline(blue(link))}.`

    return new webpack.WebpackError(bold(customMessage))
  }

  return null
}

export function handleTopLevelAwaitError(
  manifestPath: string,
  error: webpack.WebpackError
): webpack.WebpackError | null {
  const manifest = require(manifestPath)
  const topLevelAwaitMsg =
    'Top-level-await is only supported in EcmaScript Modules'

  const additionalInfo =
    "Make sure to set the module type to 'module' in your package.json or use the .mjs extension for your files."

  if (error.message.includes(topLevelAwaitMsg)) {
    const customMessage = `[${manifest.name}] ${red(
      bold(topLevelAwaitMsg + '.\n' + additionalInfo)
    )}`

    return new webpack.WebpackError(customMessage)
  }

  return null
}
