//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝

const path = require('path')

const fs = require('fs-extra')
const fancyJsonStringify = require('fancy-json-stringify')
const {log} = require('log-md')

const getTemplatePath = require('./getTemplatePath')
const abortProjectAndClean = require('./abortProjectAndClean')

const templatesDir = path.resolve(__dirname, '../templates')

const packageJsonScripts = {
  start: 'extension-create start'
}

module.exports = async function (workingDir, projectName, template) {
  const projectPath = path.resolve(workingDir, projectName)

  const templatePath = path.resolve(
    templatesDir,
    getTemplatePath(template)
  )

  const templateJsonPath = path
    .resolve(templatePath, 'template.json')

  const templateJson = require(templateJsonPath)

  const templateMetadata = templateJson.package || {}

  templateMetadata.scripts = templateMetadata.scripts || {}
  templateMetadata.dependencies = templateMetadata.dependencies || {}
  templateMetadata.devDependencies = templateMetadata.devDependencies || {}

  const packageMetadata = {
    name: path.basename(projectPath),
    private: true,
    version: '0.0.0',
    dependencies: templateMetadata.dependencies,
    devDependencies: templateMetadata.devDependencies,
    scripts: {
      ...templateMetadata.scripts,
      ...packageJsonScripts
    }
  }

  try {
    log('📝 - Writing `package.json` metadata...')
    await fs.writeFile(
      path.join(projectPath, 'package.json'),
      fancyJsonStringify(packageMetadata)
    )
  } catch (error) {
    await abortProjectAndClean(error, workingDir, projectName)
    process.exit(1)
  }
}
