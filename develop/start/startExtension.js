// ███████╗████████╗ █████╗ ██████╗ ████████╗
// ██╔════╝╚══██╔══╝██╔══██╗██╔══██╗╚══██╔══╝
// ███████╗   ██║   ███████║██████╔╝   ██║
// ╚════██║   ██║   ██╔══██║██╔══██╗   ██║
// ███████║   ██║   ██║  ██║██║  ██║   ██║
// ╚══════╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝

const path = require('path')

const { log } = require('log-md')
const githubPartials = require('github-partials')

const resoleManifest = require('./steps/resolveManifest')
const startWebpack = require('./steps/startWebpack')

module.exports = async function (projectDir, { manifest, remote }) {
  let currentProjectDir = projectDir

  try {
    if (remote) {
      githubPartials(remote)
      currentProjectDir = path.join(process.cwd(), path.basename(remote))
    }

    const resolvedManifest = await resoleManifest(currentProjectDir, manifest)

    startWebpack(currentProjectDir, resolvedManifest)
  } catch (error) {
    log(`
      Error while starting the extension: ${error}
    `)
    process.exit(1)
  }
}
