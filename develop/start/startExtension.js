// ███████╗████████╗ █████╗ ██████╗ ████████╗
// ██╔════╝╚══██╔══╝██╔══██╗██╔══██╗╚══██╔══╝
// ███████╗   ██║   ███████║██████╔╝   ██║
// ╚════██║   ██║   ██╔══██║██╔══██╗   ██║
// ███████║   ██║   ██║  ██║██║  ██║   ██║
// ╚══════╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝

const path = require('path')
const fs = require('fs-extra')

const { log } = require('log-md')
const githubPartials = require('github-partials')

const resoleManifest = require('./steps/resolveManifest')
const startWebpack = require('./steps/startWebpack')

function setCurrentProjectDirFromRemote (customPath) {
  if (new URL(customPath).hostname !== 'github.com') {
    log(`
      The remote extension URL must be stored on GitHub.
    `)
    process.exit(1)
  }

  githubPartials(customPath)
  return path.join(process.cwd(), path.basename(customPath))
}

async function setCurrentProjectDirFromLocal (customPath) {
  const extensionPath = await fs.stat(customPath)

  if (!extensionPath.isDirectory()) {
    log(`
      The local extension path must be a directory.
    `)
    process.exit(1)
  }

  return customPath
}

module.exports = async function (projectDir, { customPath }) {
  let currentProjectDir

  // console.log('👾👾👾👾👾👾👾👾👾👾👾👾', )
  try {
    if (!customPath) {
      currentProjectDir = await setCurrentProjectDirFromLocal(customPath)
    } else if (customPath.startsWith('http')) {
      currentProjectDir = setCurrentProjectDirFromRemote(customPath)
    } else {
      // No user arguments, default to cwd
      currentProjectDir = path.resolve(projectDir, customPath)
    }

    const resolvedManifest = await resoleManifest(currentProjectDir, customPath)
    startWebpack(currentProjectDir, resolvedManifest)
  } catch (error) {
    log(`
      Error while starting the extension: ${error}
    `)
    process.exit(1)
  }
}
