// ███████╗████████╗ █████╗ ██████╗ ████████╗
// ██╔════╝╚══██╔══╝██╔══██╗██╔══██╗╚══██╔══╝
// ███████╗   ██║   ███████║██████╔╝   ██║
// ╚════██║   ██║   ██╔══██║██╔══██╗   ██║
// ███████║   ██║   ██║  ██║██║  ██║   ██║
// ╚══════╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝

const { log } = require('log-md')

const resoleManifest = require('./steps/resolveManifest')
const startWebpack = require('./steps/startWebpack')

module.exports = async function (projectDir, manifestPath) {
  try {
    const resolvedManifest = await resoleManifest(projectDir, manifestPath)

    startWebpack(projectDir, resolvedManifest)
  } catch (error) {
    log(`
      Error while starting the extension: ${error}
    `)
    process.exit(1)
  }
}
