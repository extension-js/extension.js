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
      '-m, --manifest <path-to-manifest-file>',
      'use this if your manifest file doesn\'t live in the root folder'
    )
    .option(
      '-r, --remote <path-to-remote-url>',
      'download and run a remote extension hosted on GitHub'
    )
    .on('--help', () => messages.programHelp())
    .parse(process.argv)

  const projectDir = process.cwd()
  const commands = clientProgram.commands[0]
  const { remote, manifest } = commands

  startExtension(projectDir, { remote, manifest })
}

// If the module was called from the cmd line, execute it
if (require.main === module) {
  startExtensionCLI()
}

// Export as a module so it can be reused
module.exports = startExtensionCLI
