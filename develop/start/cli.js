const { program } = require('commander')
const startExtension = require('./startExtension')
const messages = require('../messages')
const packageJson = require('../package.json')

module.exports = async function () {
  program
    .version(packageJson.version)
    .command('start')
    .usage('start [options]')
    .description('start the development server')
    .option(
      '-m, --manifest [path-to-manifest-file]',
      'specify a custom path for your extensions\'s manifest file'
    )
    .on('--help', () => messages.programHelp())
    .parse(process.argv)

  const projectDir = process.cwd()
  await startExtension(projectDir, program.manifest)
}
