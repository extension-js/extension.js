import fs from 'fs'
import path from 'path'
import {spawnSync} from 'child_process'

/**
 * Validates the web extension source directory.
 * Ensures the directory exists and contains a valid `manifest.json` file.
 * @param sourcePath - The directory containing the web extension files.
 */
function validateWebExtensionSource(sourcePath: string): void {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Source path does not exist: ${sourcePath}`)
  }

  const manifestPath = path.join(sourcePath, 'manifest.json')
  if (!fs.existsSync(manifestPath)) {
    throw new Error(
      `Invalid web extension source: Missing "manifest.json" in ${sourcePath}.\n` +
        `Please ensure the directory contains a valid browser extension with a "manifest.json" file.`
    )
  }

  console.log(`Validated web extension source at: ${sourcePath}`)
}

/**
 * Generates an Xcode project for a Safari Web Extension using the `safari-web-extension-converter` tool.
 * @param sourcePath - The directory containing the browser extension to convert.
 * @param outputPath - The directory where the Xcode project will be created.
 * @param appName - The name of the project (and app).
 */
export function generateSafariProject(
  sourcePath: string,
  outputPath: string,
  appName: string,
  identifier: string
): void {
  // Validate the web extension source directory
  validateWebExtensionSource(sourcePath)

  // Ensure the output directory exists
  if (!fs.existsSync(outputPath)) {
    fs.mkdirSync(outputPath, {recursive: true})
    console.log(`Created output directory: ${outputPath}`)
  }

  console.log(`Starting Safari Web Extension conversion...`)
  console.log(`Source Pathzzzzzzz2: ${sourcePath}`)
  console.log(`Output Pathzzzzzzzz2: ${outputPath}`)
  // console.log(`App Name: ${appName}`)

  // Run the safari-web-extension-converter tool
  const result = spawnSync(
    'xcrun',
    [
      'safari-web-extension-converter',
      sourcePath,
      '--project-location',
      outputPath,
      '--app-name',
      appName,
      '--macos-only',
      '--bundle-identifier',
      `${identifier}`,
      '--no-open',
      '--no-prompt',
      // Overwrite the output directory if it exists
      '--force'
    ],
    {stdio: 'inherit'}
  )

  if (result.error) {
    throw new Error(
      `Failed to generate Safari project: ${result.error.message}`
    )
  }

  if (result.status !== 0) {
    throw new Error(
      `safari-web-extension-converter returned a non-zero status.\n` +
        `Please ensure the source directory is valid and contains a "manifest.json" file.\n` +
        `To debug, run the command manually:\n` +
        `  xcrun safari-web-extension-converter ${sourcePath} --output ${outputPath} --project-name ${appName} --verbose`
    )
  }

  console.log(
    `Safari Web Extension project created successfully in: ${path.join(
      outputPath,
      `${appName}.xcodeproj`
    )}`
  )
}
