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
    .usage('start [path-to-extension-folder]')
    .description('start the development server')

    .on('--help', () => messages.programHelp())
    .parse(process.argv)

  const projectDir = process.cwd()
  const commands = clientProgram.commands[0]
  const [, customPath] = commands.args

  startExtension(projectDir, { customPath })
}

// If the module was called from the cmd line, execute it
if (require.main === module) {
  startExtensionCLI()
}

// Export as a module so it can be reused
module.exports = startExtensionCLI
