const path = require('path')

const fs = require('fs-extra')
const { log } = require('log-md')

const templatesDir = path.resolve(__dirname, '../templates')
const defaultTemplate = 'cbe-standard-template'

module.exports = async function (workingDir, projectName) {
  const projectPath = path.resolve(workingDir, projectName)
  const templateDirPath = path
    .join(templatesDir, defaultTemplate, 'template')

  const templateName = path.basename(templateDirPath)

  try {
    log(`🧰 - Installing **${projectName}** from standard template...`)
    await fs.copy(templateDirPath, projectPath)
  } catch (error) {
    log(
      `😕❓ Can't copy template __${templateName}__: ${error}`,
      { gutter: true }
    )
    process.exit(1)
  }
}
