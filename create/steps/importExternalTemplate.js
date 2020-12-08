
const path = require('path')

const fs = require('fs-extra')
const pacote = require('pacote')
const { log } = require('log-md')

const templatesDir = path.resolve(__dirname, '../templates')

module.exports = async function (workingDir, projectName, template) {
  const projectPath = path.resolve(workingDir, projectName)
  const templateName = template

  try {
    const tempTemplatePath = path
      .join(templatesDir, `__temp__${templateName}`)

    log(`⚙️  - Importing template \`${template}\` as requested...`)
    const { name, version } = await pacote.manifest(templateName)

    await pacote
      .extract(`${name}@${version}`, tempTemplatePath)

    log((`🧰 - Installing **${projectName}** from template \`${templateName}\``))
    const templateDirPath = path.join(tempTemplatePath, 'template')

    await fs.copy(templateDirPath, projectPath)
  } catch (error) {
    log(
      `😕❓ Can't find template __${templateName}__. ${error}`,
      { gutter: true }
    )
    process.exit(1)
  }
}
