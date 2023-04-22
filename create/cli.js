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
		.command('create [project-directory]', { isDefault: true })
		.description('create a new project')
		.option('-t, --template <template>', 'Specify the template for the project')
		.usage('create <project-directory> [options]')
		.action(async (projectDir, options) => {
			let projectName;
			let templateName;

			// Check if projectDir is a string before assigning it to projectName
			if (typeof projectDir === 'string') {
				projectName = projectDir;
			} else {
				const { useCwd, projectNameInput } = await inquirer.prompt([
					{
						type: 'confirm',
						name: 'useCwd',
						message: 'No project directory provided. Do you want to use the current directory?',
						default: false,
					},
					{
						type: 'input',
						name: 'projectNameInput',
						message: 'Enter a project directory:',
						when: (answers) => !answers.useCwd,
					},
				]);

				if (useCwd) {
					projectName = '.';
				} else {
					projectName = projectNameInput;
				}
			}

			// eslint-disable-next-line prefer-const
			if (typeof options.template === 'undefined') {
				const { template } = await inquirer.prompt([
					{
						type: 'list',
						name: 'template',
						message: 'Select a template:',
						choices: [
							{
								name: 'Standard',
								value: 'standard',
							},
							{
								name: 'Popup',
								value: 'popup',
							},
						],
					},
				]);

				templateName = template;
			} else {
				templateName = options.template;
			}

			// Call the createExtension function here, within the action callback
			const workingDir = process.cwd();

			await createExtension(workingDir, projectName, templateName);
		});

  // Parse the command-line arguments
  clientProgram.parse(process.argv)
}

// If the module was called from the options line, execute it
if (require.main === module) {
  createExtensionCLI()
}

// Export as a module so it can be reused
module.exports = createExtensionCLI
