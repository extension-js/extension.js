#!/usr/bin/env node

//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝

const {program} = require('commander')
const {log} = require('log-md')

const createExtension = require('./createExtension')
const messages = require('./messages')
const packageJson = require('./package.json')

let projectName
let templateName

function createExtensionCLI (clientProgram = program) {
  clientProgram
    .version(packageJson.version)
    .command('create', {isDefault: true})
    .usage('create <project-directory> [options]')
    .action((cmd) => {
      const {args, template} = cmd

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

  if (!projectName) {
    log(`
      You need to provide an extension name to create one.
      See \`--help\` for command info.
    `)
    process.exit(1)
  }

  const workingDir = process.cwd()

  createExtension(workingDir, projectName, templateName)
}

// If the module was called from the cmd line, execute it
if (require.main === module) {
  createExtensionCLI()
}

// Export as a module so it can be reused
module.exports = createExtensionCLI
