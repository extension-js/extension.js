import webpack from 'webpack'
import {yellow, red, underline} from '@colors/colors/safe'

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
    const errorMsg = `[${manifest.name}'s content_scripts] One of your \`${extFilename}\` file imports is also defined as a content_script in manifest.json. Remove the duplicate entry and run the program again.`

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
    const noPrefixMsg = error.message.replace(cantResolveMsg, '')
    // Error message comes into the format
    // Module not found: Error: Can't resolve 'dep' in 'dep_path'.
    // We just want the 'dep' part.
    const moduleName = noPrefixMsg.split("'")[2]
    const customMessage =
      `${manifest.name} ${red('✖︎✖︎✖︎')} Module ${yellow(moduleName)} not found. ` +
      `Make sure file exists in the extension directory.\n\n` +
      `If you need to handle entries not supported by manifest.json, ` +
      `add them to the ${underline('public/')} (for static content) or ` +
      `${underline('scripts/')} folder.` +
      `\n\nRead more about special folders: ${underline((link))}.`

    return new webpack.WebpackError(customMessage)
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
      topLevelAwaitMsg + '.\n' + additionalInfo
    )}`

    return new webpack.WebpackError(customMessage)
  }

  return null
}
