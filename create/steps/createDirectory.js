//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝

const path = require('path')

const fs = require('fs-extra')
const {log} = require('log-md')

const messages = require('../messages')

const allowlist = [
  'LICENSE',
  'node_modules'
]

module.exports = async function (workingDir, projectName) {
  log(
    `👍 Starting a new browser extension named **${projectName}**`,
    {gutter: true}
  )
  const projectPath = path.resolve(workingDir, projectName)

  log(`🤞 - Checking if \`${workingDir}\` exists...`)
  await fs.ensureDir(projectName)

  log('🔎 - Scanning for potential conflicting files...')
  const currentDir = await fs.readdir(projectPath)
  const conflictingFiles = currentDir
    // .gitignore, .DS_Store, etc
    .filter(file => !file.startsWith('.'))
    // Logs of yarn/npm
    .filter(file => !file.endsWith('.log'))
    // Whatever we think is appropriate
    .filter(file => !allowlist.includes(file))

  // If directory has conflicting files, abort
  if (conflictingFiles.length) {
    await messages.directoryHasConflicts(projectPath, conflictingFiles)
    process.exit(1)
  }
}
