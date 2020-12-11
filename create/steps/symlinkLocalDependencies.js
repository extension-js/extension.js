//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝

const path = require('path')
const symlinkDir = require('symlink-dir')
const { log } = require('log-md')

const abortProjectAndClean = require('./abortProjectAndClean')

module.exports = async function (workingDir, projectName) {
  const developModulePath = path.resolve(__dirname, '../')
  const projectPath = path.resolve(workingDir, projectName)

  try {
    log('🧲  - Symlinking local dependencies...')
    await symlinkDir(developModulePath, projectPath)
  } catch (error) {
    abortProjectAndClean(error, workingDir, projectName)
  }
}
