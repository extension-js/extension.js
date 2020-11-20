const fs = require('fs-extra')
const path = require('path')
const { log } = require('log-md')

module.exports = async function (error, workingDir, projectName) {
  const projectPath = path.resolve(workingDir, projectName)

  log('😑👎 Aborting installation.')

  if (error.command) {
    log(`
      😕❓ ${error.command} has failed.
    `)
  } else {
    log(`
      🚨 Unexpected creation error. This is a bug.
    `)
    log(`Please report: "${error}"`)
    log(
      'https://github.com/cezaraugusto/create-browser-extension/issues/',
      { gutter: true }
    )
  }

  log('🧹 - Removing files generated from project in:')
  log(`\`${projectPath}\``)
  await fs.ensureDir(projectPath)
  await fs.remove(projectPath)

  log('Done.')
  process.exit(1)
}
