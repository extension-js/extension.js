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

function setWorkingDirFromRemote (workingDir, customPath) {
  if (new URL(customPath).hostname !== 'github.com') {
    log(`
      The remote extension URL must be stored on GitHub.
    `)
    process.exit(1)
  }

  githubPartials(customPath)
  return path.join(workingDir, path.basename(customPath))
}

async function setWorkingDirFromLocal (workingDir, customPath) {
  const currentPath = path.resolve(workingDir, customPath)
  const extensionPath = await fs.stat(currentPath)

  if (!extensionPath.isDirectory()) {
    log(`
      The local extension path must be a directory.
    `)
    process.exit(1)
  }

  return currentPath
}

module.exports = async function (workingDir, { customPath }) {
  let currentworkingDir

  try {
    if (!customPath) {
      // No user arguments, default to cwd
      currentworkingDir = workingDir
    } else if (customPath.startsWith('http')) {
      currentworkingDir = setWorkingDirFromRemote(customPath)
    } else {
      currentworkingDir = await setWorkingDirFromLocal(workingDir, customPath)
    }

    const resolvedManifest = await resoleManifest(currentworkingDir)
    startWebpack(currentworkingDir, resolvedManifest)
  } catch (error) {
    log(`
      Error while starting the extension: ${error}
    `)
    process.exit(1)
  }
}
