//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝

import * as path from 'path'
import * as fs from 'fs'
import chalk from 'chalk'
import {detect} from 'package-manager-detector'

export function destinationNotWriteable(workingDir: string) {
  const workingDirFolder = path.basename(workingDir)

  return (
    `${chalk.red('✖︎✖︎✖︎')} ` +
    `Failed to write in the destination directory\n\n` +
    `Path is not writable. Ensure you have write permissions for this folder.\n` +
    `${chalk.red('NOT WRITEABLE')}: ${chalk.underline(workingDirFolder)}`
  )
}

export async function directoryHasConflicts(
  projectPath: string,
  conflictingFiles: string[]
) {
  const projectName = path.basename(projectPath)

  let message =
    `\nConflict! Path to ` +
    `${chalk.cyan(projectName)} includes conflicting files:\n\n`

  for (const file of conflictingFiles) {
    const stats = await fs.promises.lstat(path.join(projectPath, file))
    message += stats.isDirectory()
      ? `${chalk.gray('-')} ${chalk.yellow(file)}\n`
      : `${chalk.gray('-')} ${chalk.yellow(file)}\n`
  }

  message +=
    '\nYou need to either rename/remove the files listed above, ' +
    'or choose a new directory name for your extension.\n' +
    `\nPath to conflicting directory: ${chalk.underline(projectPath)}`

  return message
}

export function noProjectName() {
  return (
    `${chalk.red('✖︎✖︎✖︎')} ` +
    'You need to provide an extension name to create one. ' +
    `See ${chalk.yellow('--help')} for command info.`
  )
}

export function noUrlAllowed() {
  return (
    `${chalk.red('✖︎✖︎✖︎')} ` +
    'URLs are not allowed as a project path. Either write ' +
    'a name or a path to a local folder.'
  )
}

export async function successfullInstall(
  projectPath: string,
  projectName: string
) {
  const relativePath = path.relative(process.cwd(), projectPath)
  const pm = await detect()

  let command = 'npm run'

  switch (pm?.name) {
    case 'yarn':
      command = 'yarn dev'
      break
    case 'pnpm':
      command = 'pnpm dev'
      break
    default:
      command = 'npm run dev'
  }

  // pnpx
  if (process.env.npm_config_user_agent) {
    if (process.env.npm_config_user_agent.includes('pnpm')) {
      command = 'pnpm dev'
    }
  }

  return (
    `🧩 - ${chalk.green('Success!')} Extension ${chalk.cyan(
      projectName
    )} created.\n\n` +
    `Now ${chalk.magenta(`cd ${chalk.underline(relativePath)}`)} and ` +
    `${chalk.magenta(`${command}`)} to open a new browser instance\n` +
    'with your extension installed, loaded, and enabled for development.\n\n' +
    `${chalk.green('You are ready')}. Time to hack on your extension!`
  )
}

export function startingNewExtension(projectName: string) {
  return `🐣 - Starting a new browser extension named ${chalk.cyan(projectName)}...`
}

export function checkingIfPathIsWriteable() {
  return `🤞 - Checking if destination path is writeable...`
}

export function scanningPossiblyConflictingFiles() {
  return '🔎 - Scanning for potential conflicting files...'
}

export function createDirectoryError(projectName: string, error: any) {
  return (
    `${chalk.red('✖︎✖︎✖︎')} ` +
    `Can't create directory ${chalk.cyan(projectName)}:\n${chalk.red(error)}`
  )
}

export function writingTypeDefinitions(projectName: string) {
  return `🔷 - Writing type definitions for ${chalk.cyan(projectName)}...`
}

export function writingTypeDefinitionsError(error: any) {
  return (
    `${chalk.red('✖︎✖︎✖︎')} Failed to write the extension ` +
    `type definition.\n${chalk.red(error)}`
  )
}

export function installingFromTemplate(
  projectName: string,
  templateName: string
) {
  if (templateName === 'init') {
    return `🧰 - Installing ${chalk.cyan(projectName)}...`
  }

  return (
    `🧰 - Installing ${chalk.cyan(projectName)} from ` +
    `template ${chalk.magenta(templateName)}...`
  )
}

export function installingFromTemplateError(
  projectName: string,
  template: string,
  error: any
) {
  return (
    `${chalk.red('✖︎✖︎✖︎')} Can't find template ` +
    `${chalk.magenta(template)} for ${chalk.cyan(projectName)}:\n${chalk.red(error)}`
  )
}

export function initializingGitForRepository(projectName: string) {
  return `🌲 - Initializing git repository for ${chalk.cyan(projectName)}...`
}

export function initializingGitForRepositoryFailed(
  gitCommand: string,
  gitArgs: string[],
  code: number | null
) {
  return (
    `${chalk.red('✖︎✖︎✖︎')} ` +
    `Command ${chalk.yellow(gitCommand)} ${chalk.yellow(gitArgs.join(' '))} ` +
    `failed with exit code ${code}`
  )
}

export function initializingGitForRepositoryProcessError(
  projectName: string,
  error: any
) {
  return (
    `${chalk.red('✖︎✖︎✖︎')} Child process error: Can't initialize ` +
    `${chalk.yellow('git')} for ${chalk.cyan(projectName)}:\n` +
    `${chalk.red(error.message)}`
  )
}

export function initializingGitForRepositoryError(
  projectName: string,
  error: any
) {
  return (
    `${chalk.red('✖︎✖︎✖︎')} Can't initialize ` +
    `${chalk.yellow('git')} for ${chalk.cyan(projectName)}:\n` +
    `${chalk.red(error.message || error.toString())}`
  )
}

export function installingDependencies() {
  return '🛠  - Installing dependencies... (takes a moment)'
}

export function installingDependenciesFailed(
  gitCommand: string,
  gitArgs: string[],
  code: number | null
) {
  return (
    `${chalk.red('✖︎✖︎✖︎')} ` +
    `Command ${gitCommand} ${gitArgs.join(' ')} ` +
    `failed with exit code ${code}`
  )
}

export function installingDependenciesProcessError(
  projectName: string,
  error: any
) {
  return (
    `${chalk.red('✖︎✖︎✖︎')} Child process error: Can't ` +
    `install dependencies for ${chalk.cyan(projectName)}:\n${chalk.red(error)}`
  )
}

export function cantInstallDependencies(projectName: string, error: any) {
  return (
    `${chalk.red('✖︎✖︎✖︎')} Can't install dependencies for ${chalk.cyan(projectName)}:\n` +
    `${chalk.red(error.message || error.toString())}`
  )
}

export function writingPackageJsonMetadata() {
  return `📝 - Writing ${chalk.yellow('package.json')} metadata...`
}

export function writingPackageJsonMetadataError(
  projectName: string,
  error: any
) {
  return (
    `${chalk.red('✖︎✖︎✖︎')} Can't write ` +
    `${chalk.yellow('package.json')} for ${chalk.cyan(projectName)}:\n${chalk.red(error)}`
  )
}

export function writingManifestJsonMetadata() {
  return `📜 - Writing ${chalk.yellow('manifest.json')} metadata...`
}

export function writingManifestJsonMetadataError(
  projectName: string,
  error: any
) {
  return (
    `${chalk.red('✖︎✖︎✖︎')} Can't write ` +
    `${chalk.yellow('manifest.json')} for ${chalk.cyan(projectName)}:\n${chalk.red(error)}`
  )
}

export function writingReadmeMetaData() {
  return `📄 - Writing ${chalk.yellow('README.md')} metadata...`
}

export function writingGitIgnore() {
  return `🙈 - Writing ${chalk.yellow('.gitignore')} lines...`
}

export function writingReadmeMetaDataEError(projectName: string, error: any) {
  return (
    `${chalk.red('✖︎✖︎✖︎')} ` +
    `Can't write the ${chalk.yellow('README.md')} file ` +
    `for ${chalk.cyan(projectName)}:\n${chalk.red(error)}`
  )
}

export function folderExists(projectName: string) {
  return `🤝 - Ensuring ${chalk.cyan(projectName)} folder exists...`
}

export function writingDirectoryError(error: any) {
  return (
    `${chalk.red('✖︎✖︎✖︎')} ` +
    'Error while checking directory writability:\n' +
    chalk.red(error)
  )
}

export function cantSetupBuiltInTests(projectName: string, error: any) {
  return (
    `${chalk.red('✖︎✖︎✖︎')} Can't setup built-in tests for ` +
    `${chalk.cyan(projectName)}:\n${chalk.red(error)}`
  )
}
