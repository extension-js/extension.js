// ███████╗████████╗ █████╗ ██████╗ ████████╗
// ██╔════╝╚══██╔══╝██╔══██╗██╔══██╗╚══██╔══╝
// ███████╗   ██║   ███████║██████╔╝   ██║
// ╚════██║   ██║   ██╔══██║██╔══██╗   ██║
// ███████║   ██║   ██║  ██║██║  ██║   ██║
// ╚══════╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝

const path = require('path')

const fs = require('fs-extra')

const message = require('../messages')

module.exports = async function resolveExtensionPath(workingDir, manifestFile) {
  // Defaults to user-defined path
  let manifestFilePath = manifestFile

  try {
    // Try manifest path provided by user
    await fs.access(manifestFilePath)

    return manifestFilePath
  } catch (error) {
    try {
      // User didn't provide a manifest file, check in public/
      manifestFilePath = path.join(workingDir, 'public', 'manifest.json')
      await fs.access(manifestFilePath)

      return manifestFilePath
    } catch (error) {
      try {
        // Nothing found in public/, try the root directory
        manifestFilePath = path.join(workingDir, 'manifest.json')
        await fs.access(manifestFilePath)

        return manifestFilePath
      } catch (error) {
        // Nothing found neither in public/ or path, and user did not
        // provide a --manifest option. Manifests are required so we exit.
        message.manifestNotFound()
        process.exit(1)
      }
    }
  }
}
