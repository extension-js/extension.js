import fs from 'fs'

// Rewrites the webpack runtime globals in the BrowserRuntime.js file
// to use 'chrome' or 'browser' namespace instead of webpack require
export function hardcodeNamespaceInFile(filePath: string) {
  try {
    // Read the file content
    let content = fs.readFileSync(filePath, 'utf8')

    // Replace the runtime global exports
    content = content.replace(
      /module\.exports\.RuntimeGlobal = ['"]__webpack_require__\.webExtRt['"]/,
      `module.exports.RuntimeGlobal = 'chrome'`
    )

    content = content.replace(
      /module\.exports\.RuntimeGlobalIsBrowser = ['"]__webpack_require__\.webExtRtModern['"]/,
      `module.exports.RuntimeGlobalIsBrowser = 'browser'`
    )

    // Write back to file
    fs.writeFileSync(filePath, content)
  } catch (error: any) {
    throw new Error(`Failed to rewrite runtime globals: ${error.message}`)
  }
}
