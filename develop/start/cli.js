// ███████╗████████╗ █████╗ ██████╗ ████████╗
// ██╔════╝╚══██╔══╝██╔══██╗██╔══██╗╚══██╔══╝
// ███████╗   ██║   ███████║██████╔╝   ██║
// ╚════██║   ██║   ██╔══██║██╔══██╗   ██║
// ███████║   ██║   ██║  ██║██║  ██║   ██║
// ╚══════╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝

const { program } = require('commander')

const startExtension = require('./startExtension')
const messages = require('./messages')
const packageJson = require('../package.json')

function startExtensionCLI (clientProgram = program) {
  clientProgram
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

  startExtension(projectDir, clientProgram.manifest)
}

// If the module was called from the cmd line, execute it
if (require.main === module) {
  startExtensionCLI()
}

// Export as a module so it can be reused
module.exports = startExtensionCLI
