//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝

import * as path from 'path'
import * as fs from 'fs'
import colors from 'pintor'
import {detect} from 'package-manager-detector'

export function destinationNotWriteable(workingDir: string) {
  const workingDirFolder = path.basename(workingDir)

  return (
    `${colors.red('✖︎✖︎✖︎')} ` +
    `Failed to write in the destination directory\n\n` +
    `Path is not writable. Ensure you have write permissions for this folder.\n` +
    `${colors.red('NOT WRITEABLE')}: ${colors.underline(workingDirFolder)}`
  )
}

export async function directoryHasConflicts(
  projectPath: string,
  conflictingFiles: string[]
) {
  const projectName = path.basename(projectPath)

  let message =
    `\nConflict! Path to ` +
    `${colors.cyan(projectName)} includes conflicting files:\n\n`

  for (const file of conflictingFiles) {
    const stats = await fs.promises.lstat(path.join(projectPath, file))
    message += stats.isDirectory()
      ? `${colors.gray('-')} ${colors.yellow(file)}\n`
      : `${colors.gray('-')} ${colors.yellow(file)}\n`
  }

  message +=
    '\nYou need to either rename/remove the files listed above, ' +
    'or choose a new directory name for your extension.\n' +
    `\nPath to conflicting directory: ${colors.underline(projectPath)}`

  return message
}

export function noProjectName() {
  return (
    `${colors.red('✖︎✖︎✖︎')} ` +
    'You need to provide an extension name to create one. ' +
    `See ${colors.yellow('--help')} for command info.`
  )
}

export function noUrlAllowed() {
  return (
    `${colors.red('✖︎✖︎✖︎')} ` +
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
    `🧩 - ${colors.green('Success!')} Extension ${colors.cyan(
      projectName
    )} created.\n\n` +
    `Now ${colors.magenta(`cd ${colors.underline(relativePath)}`)} and ` +
    `${colors.magenta(`${command}`)} to open a new browser instance\n` +
    'with your extension installed, loaded, and enabled for development.\n\n' +
    `${colors.green('You are ready')}. Time to hack on your extension!`
  )
}

export function startingNewExtension(projectName: string) {
  return `🐣 - Starting a new browser extension named ${colors.cyan(projectName)}...`
}

export function checkingIfPathIsWriteable() {
  return `🤞 - Checking if destination path is writeable...`
}

export function scanningPossiblyConflictingFiles() {
  return '🔎 - Scanning for potential conflicting files...'
}

export function createDirectoryError(projectName: string, error: any) {
  return (
    `${colors.red('✖︎✖︎✖︎')} ` +
    `Can't create directory ${colors.cyan(projectName)}:\n${colors.red(error)}`
  )
}

export function writingTypeDefinitions(projectName: string) {
  return `🔷 - Writing type definitions for ${colors.cyan(projectName)}...`
}

export function writingTypeDefinitionsError(error: any) {
  return (
    `${colors.red('✖︎✖︎✖︎')} Failed to write the extension ` +
    `type definition.\n${colors.red(error)}`
  )
}

export function installingFromTemplate(
  projectName: string,
  templateName: string
) {
  if (templateName === 'init') {
    return `🧰 - Installing ${colors.cyan(projectName)}...`
  }

  return (
    `🧰 - Installing ${colors.cyan(projectName)} from ` +
    `template ${colors.magenta(templateName)}...`
  )
}

export function installingFromTemplateError(
  projectName: string,
  template: string,
  error: any
) {
  return (
    `${colors.red('✖︎✖︎✖︎')} Can't find template ` +
    `${colors.magenta(template)} for ${colors.cyan(projectName)}:\n${colors.red(error)}`
  )
}

export function initializingGitForRepository(projectName: string) {
  return `🌲 - Initializing git repository for ${colors.cyan(projectName)}...`
}

export function initializingGitForRepositoryFailed(
  gitCommand: string,
  gitArgs: string[],
  code: number | null
) {
  return (
    `${colors.red('✖︎✖︎✖︎')} ` +
    `Command ${colors.yellow(gitCommand)} ${colors.yellow(gitArgs.join(' '))} ` +
    `failed with exit code ${code}`
  )
}

export function initializingGitForRepositoryProcessError(
  projectName: string,
  error: any
) {
  return (
    `${colors.red('✖︎✖︎✖︎')} Child process error: Can't initialize ` +
    `${colors.yellow('git')} for ${colors.cyan(projectName)}:\n` +
    `${colors.red(error.message)}`
  )
}

export function initializingGitForRepositoryError(
  projectName: string,
  error: any
) {
  return (
    `${colors.red('✖︎✖︎✖︎')} Can't initialize ` +
    `${colors.yellow('git')} for ${colors.cyan(projectName)}:\n` +
    `${colors.red(error.message || error.toString())}`
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
    `${colors.red('✖︎✖︎✖︎')} ` +
    `Command ${gitCommand} ${gitArgs.join(' ')} ` +
    `failed with exit code ${code}`
  )
}

export function installingDependenciesProcessError(
  projectName: string,
  error: any
) {
  return (
    `${colors.red('✖︎✖︎✖︎')} Child process error: Can't ` +
    `install dependencies for ${colors.cyan(projectName)}:\n${colors.red(error)}`
  )
}

export function cantInstallDependencies(projectName: string, error: any) {
  return (
    `${colors.red('✖︎✖︎✖︎')} Can't install dependencies for ${colors.cyan(projectName)}:\n` +
    `${colors.red(error.message || error.toString())}`
  )
}

export function writingPackageJsonMetadata() {
  return `📝 - Writing ${colors.yellow('package.json')} metadata...`
}

export function writingPackageJsonMetadataError(
  projectName: string,
  error: any
) {
  return (
    `${colors.red('✖︎✖︎✖︎')} Can't write ` +
    `${colors.yellow('package.json')} for ${colors.cyan(projectName)}:\n${colors.red(error)}`
  )
}

export function writingManifestJsonMetadata() {
  return `📜 - Writing ${colors.yellow('manifest.json')} metadata...`
}

export function writingManifestJsonMetadataError(
  projectName: string,
  error: any
) {
  return (
    `${colors.red('✖︎✖︎✖︎')} Can't write ` +
    `${colors.yellow('manifest.json')} for ${colors.cyan(projectName)}:\n${colors.red(error)}`
  )
}

export function writingReadmeMetaData() {
  return `📄 - Writing ${colors.yellow('README.md')} metadata...`
}

export function writingGitIgnore() {
  return `🙈 - Writing ${colors.yellow('.gitignore')} lines...`
}

export function writingReadmeMetaDataEError(projectName: string, error: any) {
  return (
    `${colors.red('✖︎✖︎✖︎')} ` +
    `Can't write the ${colors.yellow('README.md')} file ` +
    `for ${colors.cyan(projectName)}:\n${colors.red(error)}`
  )
}

export function folderExists(projectName: string) {
  return `🤝 - Ensuring ${colors.cyan(projectName)} folder exists...`
}

export function writingDirectoryError(error: any) {
  return (
    `${colors.red('✖︎✖︎✖︎')} ` +
    'Error while checking directory writability:\n' +
    colors.red(error)
  )
}

export function cantSetupBuiltInTests(projectName: string, error: any) {
  return (
    `${colors.red('✖︎✖︎✖︎')} Can't setup built-in tests for ` +
    `${colors.cyan(projectName)}:\n${colors.red(error)}`
  )
}
