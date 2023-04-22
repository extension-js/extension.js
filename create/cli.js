#!/usr/bin/env node

//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝

const {program} = require('commander')
const createExtension = require('./createExtension')
const packageJson = require('./package.json')
// Const inquirer = require('inquirer');

async function createExtensionCLI(clientProgram = program) {
  // eslint-disable-next-line no-unused-expressions
  const inquirer = (await import('inquirer')).default

  clientProgram
    .version(packageJson.version)
    .command('create', {isDefault: true})
    .usage('create <project-directory> [options]')
    .action(async (projectDir, cmd) => {
      let projectName
      let templateName

      // Check if projectDir is a string before assigning it to projectName
      if (typeof projectDir === 'string') {
        projectName = projectDir
      } else {
        const {useCwd, projectNameInput} = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'useCwd',
            message:
              'No project directory provided. Do you want to use the current directory?',
            default: false
          },
          {
            type: 'input',
            name: 'projectNameInput',
            message: 'Enter a project directory:',
            when: (answers) => !answers.useCwd
          }
        ])

        if (useCwd) {
          projectName = '.'
        } else {
          projectName = projectNameInput
        }
      }

      // eslint-disable-next-line prefer-const
      templateName = cmd.template

      // Call the createExtension function here, within the action callback
      const workingDir = process.cwd()

      await createExtension(workingDir, projectName, templateName)
    })

  // Parse the command-line arguments
  clientProgram.parse(process.argv)
}

// If the module was called from the cmd line, execute it
if (require.main === module) {
  createExtensionCLI()
}

// Export as a module so it can be reused
module.exports = createExtensionCLI
