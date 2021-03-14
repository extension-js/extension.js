//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝

const path = require('path')

const fs = require('fs-extra')
const spawn = require('cross-spawn')
const {log} = require('log-md')

const abortProjectAndClean = require('./abortProjectAndClean')

module.exports = async function (workingDir, projectName) {
  const projectPath = path.resolve(workingDir, projectName)
  const projectPackageJson = path.join(projectPath, 'package.json')
  const packageMetadata = require(projectPackageJson)

  const dependencies = packageMetadata.dependencies || []
  const devDependencies = packageMetadata.devDependencies || []

  if (
    dependencies.length === 0 &&
    devDependencies.length === 0
  ) {
    log('⏭  - No dependencies. Skipping install step...')

    return
  }

  const command = 'npm'
  const commonArgs = ['--prefix', projectPath]

  try {
    log('🛠  - Installing extension-create as devDependency...')
    // Link instead of download in local env
    if (process.env.NODE_ENV === 'development') {
      await fs.ensureSymlink(`${projectPath}/node_modules`, workingDir)
    } else {
      const installSelfArgs = [
        ...commonArgs,
        'install',
        '-D',
        'extension-create',
        '--silent'
      ]

      spawn.sync(command, installSelfArgs, {stdio: 'inherit'})
    }

    log('⚙️  - Installing package dependencies...')
    const installArgs = [...commonArgs, 'install', '--exact', '--silent']

    spawn.sync(command, installArgs, {stdio: 'inherit'})
    await Promise.resolve()
  } catch (error) {
    abortProjectAndClean(error, workingDir, projectName)
  }
}
