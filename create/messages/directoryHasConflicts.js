const fs = require('fs-extra')
const path = require('path')
const { log } = require('log-md')

module.exports = async function (projectPath, conflictingFiles) {
  const projectName = path.basename(projectPath)

  log(
    `Conflict! Directory \`${(projectName)}/\` includes conflicting files:`,
    { gutter: true }
  )

  for (const file of conflictingFiles) {
    const stats = await fs.lstat(path.join(projectPath, file))

    log(
      stats.isDirectory()
        ? `   📁 - ${file}/`
        : `       📄 - ${file}`
    )
  }

  log(
    'You need to either rename/remove the files listed above,\n' +
    'or choose a new directory name for your extension.',
    { gutter: true }
  )

  log(`Path to conflicting directory: \`${projectPath}\``)
}
