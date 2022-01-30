// ███████╗████████╗ █████╗ ██████╗ ████████╗
// ██╔════╝╚══██╔══╝██╔══██╗██╔══██╗╚══██╔══╝
// ███████╗   ██║   ███████║██████╔╝   ██║
// ╚════██║   ██║   ██╔══██║██╔══██╗   ██║
// ███████║   ██║   ██║  ██║██║  ██║   ██║
// ╚══════╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝

const path = require('path')

const fs = require('fs-extra')

const message = require('../messages')

module.exports = async function resolveManifest(workingDir) {
  let manifestFilePath

  // Iterate over common paths looking for the manifest file.
  try {
    // Start from usual suspects, check src/
    await fs.access(path.join(workingDir, 'src', 'manifest.json'))

    return manifestFilePath
  } catch (error) {
    try {
      // Check in public/
      manifestFilePath = path.join(workingDir, 'public', 'manifest.json')
      await fs.access(manifestFilePath)

      return manifestFilePath
    } catch (error) {
      try {
        // Check the root directory
        manifestFilePath = path.join(workingDir, 'manifest.json')
        await fs.access(manifestFilePath)

        return manifestFilePath
      } catch (error) {
        // Nothing found. Manifests are required so we exit.
        message.manifestNotFound()
        process.exit(1)
      }
    }
  }
}
