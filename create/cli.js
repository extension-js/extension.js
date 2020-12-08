const { program } = require('commander')

const createExtension = require('./createExtension')
const messages = require('./messages')
const packageJson = require('./package.json')

let projectName
let templateName

module.exports = async function () {
  program
    .version(packageJson.version)
    .command('create', { isDefault: true })
    .usage('create <project-directory> [options]')
    .action((cmd) => {
      const { args, template } = cmd

      projectName = args[0]
      templateName = template
    })
    .description('create a new cross-browser extension')
    .option(
      '-t, --template <template-name>',
      'specify a template for the created project'
    )
    .on('--help', () => messages.programHelp())
    .parse(process.argv)

  const workingDir = process.cwd()

  await createExtension(workingDir, projectName, templateName)
}
