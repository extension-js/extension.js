const { program } = require('commander')
const createExtension = require('./createExtension')
const messages = require('./messages')
const packageJson = require('./package.json')

let projectName

module.exports = function () {
  program
    .version(packageJson.version)
    .arguments('<project-directory>')
    .usage('<project-directory> [options]')
    .action(name => { projectName = name })
    .option(
      '-t, --template <template-name>',
      'specify a template for the created project'
    )
    .on('--help', () => messages.programHelp())
    .parse(process.argv)

  const workingDir = process.cwd()
  createExtension(workingDir, projectName, program.template)
}
