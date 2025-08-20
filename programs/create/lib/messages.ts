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
    `${colors.red('ERROR')} Failed to write in the destination directory.\n` +
    `${colors.red('Path is not writable. Ensure you have write permissions for this folder.')}` +
    `\n${colors.red('NOT WRITEABLE')} ${colors.underline(workingDirFolder)}`
  )
}

export async function directoryHasConflicts(
  projectPath: string,
  conflictingFiles: string[]
) {
  const projectName = path.basename(projectPath)

  let message = `Conflict! Path to ${colors.yellow(projectName)} includes conflicting files.\n`

  for (const file of conflictingFiles) {
    const stats = await fs.promises.lstat(path.join(projectPath, file))
    message += stats.isDirectory()
      ? `${colors.gray('-')} ${colors.yellow(file)}\n`
      : `${colors.gray('-')} ${colors.yellow(file)}\n`
  }

  message +=
    `${colors.red('You need to either rename/remove the files listed above, or choose a new directory name for your extension.')}` +
    `\nPath to conflicting directory: ${colors.underline(projectPath)}`

  return message
}

export function noProjectName() {
  return (
    `${colors.red('ERROR')} You need to provide an extension name to create one. ` +
    `See ${colors.blue('--help')} for command info.`
  )
}

export function noUrlAllowed() {
  return `${colors.red('ERROR')} URLs are not allowed as a project path. Either write a name or a path to a local folder.`
}

export async function successfullInstall(
  projectPath: string,
  projectName: string
) {
  const relativePath = path.relative(process.cwd(), projectPath)
  const pm = await detect()

  let command = 'npm run'
  let installCmd = 'npm install'

  switch (pm?.name) {
    case 'yarn':
      command = 'yarn dev'
      installCmd = 'yarn'
      break
    case 'pnpm':
      command = 'pnpm dev'
      installCmd = 'pnpm install'
      break
    default:
      command = 'npm run dev'
      installCmd = 'npm install'
  }

  // pnpx
  if (process.env.npm_config_user_agent) {
    if (process.env.npm_config_user_agent.includes('pnpm')) {
      command = 'pnpm dev'
      installCmd = 'pnpm install'
    }
  }

  return (
    `🧩 - ${colors.green('Success!')} Extension ${colors.yellow(projectName)} created.\n` +
    `Now ${colors.blue('cd')} ${colors.underline(relativePath)}\n` +
    `${colors.blue(installCmd)} to install dependencies\n` +
    `${colors.blue(command)} to open a new browser instance\n` +
    `with your extension installed, loaded, and enabled for development.\n` +
    `${colors.green('You are ready')}. Time to hack on your extension!`
  )
}

export function startingNewExtension(projectName: string) {
  return `🐣 - Starting a new browser extension named ${colors.yellow(projectName)}...`
}

export function checkingIfPathIsWriteable() {
  return `🤞 - Checking if destination path is writeable...`
}

export function scanningPossiblyConflictingFiles() {
  return '🔎 - Scanning for potential conflicting files...'
}

export function createDirectoryError(projectName: string, error: any) {
  return `${colors.red('ERROR')} Can't create directory ${colors.yellow(projectName)}.\n${colors.red(String(error))}`
}

export function writingTypeDefinitions(projectName: string) {
  return `🔷 - Writing type definitions for ${colors.yellow(projectName)}...`
}

export function writingTypeDefinitionsError(error: any) {
  return `${colors.red('ERROR')} Failed to write the extension type definition.\n${colors.red(String(error))}`
}

export function installingFromTemplate(
  projectName: string,
  templateName: string
) {
  if (templateName === 'init') {
    return `🧰 - Installing ${colors.yellow(projectName)}...`
  }

  return `🧰 - Installing ${colors.yellow(projectName)} from template ${colors.yellow(templateName)}...`
}

export function installingFromTemplateError(
  projectName: string,
  template: string,
  error: any
) {
  return `${colors.red('ERROR')} Can't find template ${colors.yellow(template)} for ${colors.yellow(projectName)}.\n${colors.red(String(error))}`
}

export function initializingGitForRepository(projectName: string) {
  return `🌲 - Initializing git repository for ${colors.yellow(projectName)}...`
}

export function initializingGitForRepositoryFailed(
  gitCommand: string,
  gitArgs: string[],
  code: number | null
) {
  return `${colors.red('ERROR')} Command ${colors.gray(gitCommand)} ${colors.gray(gitArgs.join(' '))} failed.\n${colors.red(`exit code ${colors.gray(String(code))}`)}`
}

export function initializingGitForRepositoryProcessError(
  projectName: string,
  error: any
) {
  return `${colors.red('ERROR')} Child process error: Can't initialize ${colors.gray('git')} for ${colors.yellow(projectName)}.\n${colors.red(String(error?.message || error))}`
}

export function initializingGitForRepositoryError(
  projectName: string,
  error: any
) {
  return `${colors.red('ERROR')} Can't initialize ${colors.gray('git')} for ${colors.yellow(projectName)}.\n${colors.red(String(error?.message || error))}`
}

export function installingDependencies() {
  return '🛠  - Installing dependencies... (takes a moment)'
}

export function installingDependenciesFailed(
  gitCommand: string,
  gitArgs: string[],
  code: number | null
) {
  return `${colors.red('ERROR')} Command ${colors.gray(gitCommand)} ${colors.gray(gitArgs.join(' '))} failed.\n${colors.red(`exit code ${colors.gray(String(code))}`)}`
}

export function installingDependenciesProcessError(
  projectName: string,
  error: any
) {
  return `${colors.red('ERROR')} Child process error: Can't install dependencies for ${colors.yellow(projectName)}.\n${colors.red(String(error))}`
}

export function cantInstallDependencies(projectName: string, error: any) {
  return `${colors.red('ERROR')} Can't install dependencies for ${colors.yellow(projectName)}.\n${colors.red(String(error?.message || error))}`
}

export function writingPackageJsonMetadata() {
  return `📝 - Writing ${colors.yellow('package.json')} metadata...`
}

export function writingPackageJsonMetadataError(
  projectName: string,
  error: any
) {
  return `${colors.red('ERROR')} Can't write ${colors.yellow('package.json')} for ${colors.yellow(projectName)}.\n${colors.red(String(error))}`
}

export function writingManifestJsonMetadata() {
  return `📜 - Writing ${colors.yellow('manifest.json')} metadata...`
}

export function writingManifestJsonMetadataError(
  projectName: string,
  error: any
) {
  return `${colors.red('ERROR')} Can't write ${colors.yellow('manifest.json')} for ${colors.yellow(projectName)}.\n${colors.red(String(error))}`
}

export function writingReadmeMetaData() {
  return `📄 - Writing ${colors.yellow('README.md')} metadata...`
}

export function writingGitIgnore() {
  return `🙈 - Writing ${colors.yellow('.gitignore')} lines...`
}

export function writingReadmeMetaDataEError(projectName: string, error: any) {
  return `${colors.red('ERROR')} Can't write the ${colors.yellow('README.md')} file for ${colors.yellow(projectName)}.\n${colors.red(String(error))}`
}

export function folderExists(projectName: string) {
  return `🤝 - Ensuring ${colors.yellow(projectName)} folder exists...`
}

export function writingDirectoryError(error: any) {
  return `${colors.red('ERROR')} Error while checking directory writability.\n${colors.red(String(error))}`
}

export function cantSetupBuiltInTests(projectName: string, error: any) {
  return `${colors.red('ERROR')} Can't setup built-in tests for ${colors.yellow(projectName)}.\n${colors.red(String(error))}`
}
