import path from 'path'

export function fileError(feature: string | undefined, filePath: string) {
  if (!feature) {
    throw new Error('This operation is impossible. Please report a bug.')
  }

  switch (path.extname(filePath)) {
    case '.js':
    case '.ts':
    case '.jsx':
    case '.tsx':
      return javaScriptError(feature, filePath)
    case '.css':
    case '.scss':
    case '.sass':
    case '.less':
      return cssError(feature, filePath)
    default:
      return staticAssetErrorMessage(feature, filePath)
  }
}

export function reloadAfterErrorRequiredMessage() {
  const hintMessage = `and run the program again.`
  const errorMessage = `Ensure \`<script>\` sources are valid ${hintMessage}`
  return errorMessage
}

export function manifestMissingError() {
  const hintMessage = `Check your manifest.json file.`
  const errorMessage = `File \`manifest.json\` not found. ${hintMessage}`
  return errorMessage
}

export function manifestFieldRequiredError(requiredField: string) {
  const hintMessage = `Update your manifest.json file to run your extension.`
  const errorMessage = `Field \`${requiredField}\` is required. ${hintMessage}`
  return errorMessage
}

export function manifestFieldError(feature: string, htmlFilePath: string) {
  const hintMessage = `Check the ${feature} field in your manifest.json file.`
  const pagesMessage = `Check the \`pages\` field in your manifest.json file.`
  const isPage = feature === 'pages'
  const errorMessage = `File path \`${htmlFilePath}\` not found. ${
    isPage ? pagesMessage : hintMessage
  }`
  return errorMessage
}

export function javaScriptError(htmlFilePath: string, inputFilepath: string) {
  const hintMessage = `Check your <script> tags in \`${htmlFilePath}\`.`
  const errorMessage = `File path \`${inputFilepath}\` not found. ${hintMessage}`
  return errorMessage
}

export function cssError(htmlFilePath: string, inputFilepath: string) {
  const hintMessage = `Check your <link> tags in \`${htmlFilePath}\`.`
  const errorMessage = `File path \`${inputFilepath}\` not found. ${hintMessage}`
  return errorMessage
}

export function staticAssetErrorMessage(
  htmlFilePath: string,
  inputFilepath: string
) {
  const extname = path.extname(inputFilepath)
  const hintMessage = `Check your *${extname} file paths in \`${htmlFilePath}\`.`
  const errorMessage = `File path \`${inputFilepath}\` not found. ${hintMessage}`
  return errorMessage
}
