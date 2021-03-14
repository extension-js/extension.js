// ███████╗████████╗ █████╗ ██████╗ ████████╗
// ██╔════╝╚══██╔══╝██╔══██╗██╔══██╗╚══██╔══╝
// ███████╗   ██║   ███████║██████╔╝   ██║
// ╚════██║   ██║   ██╔══██║██╔══██╗   ██║
// ███████║   ██║   ██║  ██║██║  ██║   ██║
// ╚══════╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝

const path = require('path')

const fs = require('fs-extra')
const {log} = require('log-md')
const goGitIt = require('go-git-it')

const resoleManifest = require('./steps/resolveManifest')
const startWebpack = require('./steps/startWebpack')

function setWorkingDirFromRemote (workingDir, customPath) {
  if (new URL(customPath).hostname !== 'github.com') {
    log(`
      The remote extension URL must be stored on GitHub.
    `)
    process.exit(1)
  }

  goGitIt(customPath)

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

module.exports = async function (workingDir, {customPath, browserVendor}) {
  let currentworkingDir

  try {
    if (!customPath) {
      // No user arguments, default to cwd
      currentworkingDir = workingDir
    } else if (customPath.startsWith('http')) {
      currentworkingDir = setWorkingDirFromRemote(workingDir, customPath)
    } else {
      currentworkingDir = await setWorkingDirFromLocal(workingDir, customPath)
    }

    const resolvedManifest = await resoleManifest(currentworkingDir)

    startWebpack(currentworkingDir, {
      manifestPath: resolvedManifest,
      browserVendor
    })
  } catch (error) {
    log(`
      Error while starting the extension: ${error}
    `)
    process.exit(1)
  }
}
