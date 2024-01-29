export function serverRestartRequired() {
  const errorMessage = `[manifest.json] Entry Point Modification Found.

Changing the path of non-static assets defined in manifest.json requires a server restart. To apply these changes, restart the program and try again.`
  return errorMessage
}

export function manifestFieldError(feature: string, htmlFilePath: string) {
  const hintMessage = `Check the \`${feature}\` field in your manifest.json file and try again.`

  const errorMessage = `[manifest.json] File path \`${htmlFilePath}\` not found. ${hintMessage}`
  return errorMessage
}
