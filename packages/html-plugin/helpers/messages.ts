import path from 'path'

export function fileError(
  manifestPath: string,
  feature: string | undefined,
  filePath: string
) {
  if (!feature) {
    throw new Error('This operation is impossible. Please report a bug.')
  }

  const projectDir = path.dirname(manifestPath)

  switch (path.extname(filePath)) {
    case '.js':
    case '.ts':
    case '.jsx':
    case '.tsx':
      return javaScriptError(projectDir, feature, filePath)
    case '.css':
    case '.scss':
    case '.sass':
    case '.less':
      return cssError(projectDir, feature, filePath)
    default:
      return staticAssetErrorMessage(projectDir, feature, filePath)
  }
}

export function serverRestartRequired(projectDir: string, filePath: string) {
  const basename = path.relative(projectDir, filePath)
  const errorMessage = `[${basename}] Entry Point Modification Found

Changing <script> or <link rel="stylesheet"> source paths after compilation requires a server restart. Restart the program and try again.`

  return errorMessage
}

export function reloadAfterErrorRequiredMessage() {
  const hintMessage = `and run the program again.`
  const errorMessage = `Ensure \`<script>\` sources are valid ${hintMessage}`
  return errorMessage
}

export function manifestMissingError() {
  const hintMessage = `A manifest file is required for this plugin to run.`
  const errorMessage = `File \`manifest.json\` not found. ${hintMessage}`
  return `[manifest.json]: ${errorMessage}`
}

export function manifestFieldRequiredError(requiredField: string) {
  const hintMessage = `Update your manifest.json file to run your extension.`
  const errorMessage = `Field \`${requiredField}\` is required. ${hintMessage}`
  return errorMessage
}

export function manifestFieldError(feature: string, htmlFilePath: string) {
  const hintMessage = `Check the ${feature} field in your manifest.json file.`
  const pagesMessage = `Check the \`pages\` folder in your project root directory.`
  const isPage = feature.startsWith('pages')
  const errorMessage = `File path \`${htmlFilePath}\` not found. ${
    isPage ? pagesMessage : hintMessage
  }`
  return `[manifest.json]: ${errorMessage}`
}

export function javaScriptError(
  manifestPath: string,
  htmlFilePath: string,
  inputFilepath: string
) {
  const pathRelative = path.relative(manifestPath, htmlFilePath)
  const hintMessage = `Check your <script> tags in \`${htmlFilePath}\`.`
  const errorMessage = `[${pathRelative}] File not found\n- \`${inputFilepath}\` (not found)\n\n${hintMessage}`
  return errorMessage
}

export function cssError(
  manifestPath: string,
  htmlFilePath: string,
  inputFilepath: string
) {
  const pathRelative = path.relative(manifestPath, htmlFilePath)
  const hintMessage = `Check your <link> tags in \`${htmlFilePath}\`.`
  const errorMessage = `[${pathRelative}] File not found\n- \`${inputFilepath}\` (not found)\n\n${hintMessage}`
  return errorMessage
}

export function staticAssetErrorMessage(
  manifestPath: string,
  htmlFilePath: string,
  inputFilepath: string
) {
  const extname = path.extname(inputFilepath)
  const pathRelative = path.relative(manifestPath, htmlFilePath)
  const hintMessage = `Check your *${extname} assets in \`${htmlFilePath}\`.`
  const errorMessage = `[${pathRelative}] File not found\n- \`${inputFilepath}\` (not found)\n${hintMessage}`
  return errorMessage
}
