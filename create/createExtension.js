//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝

const createDirectory = require('./steps/createDirectory')
const importExternalTemplate = require('./steps/importExternalTemplate')
const importLocalTemplate = require('./steps/importLocalTemplate')
const writePackageJson = require('./steps/writePackageJson')
const installDependencies = require('./steps/installDependencies')
const symlinkLocalDependencies = require('./steps/symlinkLocalDependencies')
const messages = require('./messages')
const abortAndClean = require('./steps/abortProjectAndClean')
const cleanTemplateFolder = require('./steps/cleanTemplateFolder')

process.on('unhandledRejection', (error) => { throw error })

module.exports = async function (workingDir, projectName, template) {
  try {
    await createDirectory(workingDir, projectName)

    template
      ? await importExternalTemplate(workingDir, projectName, template)
      : await importLocalTemplate(workingDir, projectName)

    await writePackageJson(workingDir, projectName, template)
    await installDependencies(workingDir, projectName)
    await symlinkLocalDependencies(workingDir, projectName)
    await cleanTemplateFolder(template)
    await messages.successfulInstall(workingDir, projectName)
  } catch (error) {
    await abortAndClean(error, workingDir, projectName)
    await cleanTemplateFolder(template)
  }
}
