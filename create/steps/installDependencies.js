//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝

const path = require('path')

const pacote = require('pacote')
const { log } = require('log-md')

const abortProjectAndClean = require('./abortProjectAndClean')

module.exports = async function (workingDir, projectName) {
  const projectPath = path.resolve(workingDir, projectName)
  const projectPackageJson = path.join(projectPath, 'package.json')
  const packageMetadata = require(projectPackageJson)

  const dependencies = Object.entries({
    ...packageMetadata.dependencies,
    ...packageMetadata.devDependencies
  })

  if (dependencies.length === 0) {
    log('⏭  - No dependencies. Skipping install step...')

    return
  }

  log('🛠  - Installing dependencies...')

  try {
    for await (const dependency of dependencies) {
      const [name, version] = dependency

      log(`   └── Installing \`${name}\`@_${version}_...`)
      pacote.extract(
        `${name}@${version}`,
        `${projectPath}/node_modules`
      )
    }
  } catch (error) {
    abortProjectAndClean(error, workingDir, projectName)
  }
}
