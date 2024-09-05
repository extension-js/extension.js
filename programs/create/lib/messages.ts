//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝

import path from 'path'
import {
  red,
  gray,
  cyan,
  brightYellow,
  magenta,
  brightGreen,
  underline
} from '@colors/colors/safe'
import fs from 'fs/promises'
import {detect} from 'detect-package-manager'

export function destinationNotWriteable(workingDir: string) {
  const workingDirFolder = path.basename(workingDir)

  return (
    `${red(`✖︎✖︎✖︎`)} ` +
    `Failed to write in the destination directory\n\n` +
    `Path is not writable. Ensure you have write permissions for this folder.\n` +
    `${red('NOT WRITEABLE')}: ${underline(workingDirFolder)}`
  )
}

export async function directoryHasConflicts(
  projectPath: string,
  conflictingFiles: string[]
) {
  const projectName = path.basename(projectPath)

  let message =
    `\nConflict! Path to ` +
    `${cyan(projectName)} includes conflicting files:\n\n`

  for (const file of conflictingFiles) {
    const stats = await fs.lstat(path.join(projectPath, file))
    message += stats.isDirectory()
      ? `${gray('-')} ${brightYellow(file)}\n`
      : `${gray('-')} ${brightYellow(file)}\n`
  }

  message +=
    '\nYou need to either rename/remove the files listed above, ' +
    'or choose a new directory name for your extension.\n' +
    `\nPath to conflicting directory: ${underline(projectPath)}`

  return message
}

export function noProjectName() {
  return (
    `${red(`✖︎✖︎✖︎`)} ` +
    'You need to provide an extension name to create one. ' +
    `See ${brightYellow('--help')} for command info.`
  )
}

export function noUrlAllowed() {
  return (
    `${red(`✖︎✖︎✖︎`)} ` +
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

  switch (pm) {
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
    `🧩 - ${brightGreen('Success!')} Extension ${cyan(
      projectName
    )} created.\n\n` +
    `Now ${magenta(`cd ${underline(relativePath)}`)} and ` +
    `${magenta(`${command}`)} to open a new browser instance\n` +
    'with your extension installed, loaded, and enabled for development.\n\n' +
    `${brightGreen('You are ready')}. Time to hack on your extension!`
  )
}

export function startingNewExtension(projectName: string) {
  return `🐣 - Starting a new browser extension named ${cyan(projectName)}...`
}

export function checkingIfPathIsWriteable() {
  return `🤞 - Checking if destination path is writeable...`
}

export function scanningPossiblyConflictingFiles() {
  return '🔎 - Scanning for potential conflicting files...'
}

export function createDirectoryError(projectName: string, error: any) {
  return (
    `${red(`✖︎✖︎✖︎`)} ` +
    `Can't create directory ${cyan(projectName)}:\n${red(error)}`
  )
}

export function writingTypeDefinitions(projectName: string) {
  return `🔷 - Writing type definitions for ${cyan(projectName)}...`
}

export function writingTypeDefinitionsError(error: any) {
  return (
    `${red(`✖︎✖︎✖︎`)} Failed to write the extension ` +
    `type definition.\n${red(error)}`
  )
}

export function installingFromTemplate(
  projectName: string,
  templateName: string
) {
  if (templateName === 'init') {
    return `🧰 - Installing ${cyan(projectName)}...`
  }

  return (
    `🧰 - Installing ${cyan(projectName)} from ` +
    `template ${magenta(templateName)}...`
  )
}

export function installingFromTemplateError(
  projectName: string,
  template: string,
  error: any
) {
  return (
    `${red(`✖︎✖︎✖︎`)} Can't find template ` +
    `${magenta(template)} for ${cyan(projectName)}:\n${red(error)}`
  )
}

export function initializingGitForRepository(projectName: string) {
  return `🌲 - Initializing git repository for ${cyan(projectName)}...`
}

export function initializingGitForRepositoryFailed(
  gitCommand: string,
  gitArgs: string[],
  code: number | null
) {
  return (
    `${red(`✖︎✖︎✖︎`)} ` +
    `Command ${brightYellow(gitCommand)} ${brightYellow(gitArgs.join(' '))} ` +
    `failed with exit code ${code}`
  )
}

export function initializingGitForRepositoryProcessError(
  projectName: string,
  error: any
) {
  return (
    `${red(`✖︎✖︎✖︎`)} Child process error: Can't initialize ` +
    `${brightYellow('git')} for ${cyan(projectName)}:\n` +
    `${red(error.message)}`
  )
}

export function initializingGitForRepositoryError(
  projectName: string,
  error: any
) {
  return (
    `${red(`✖︎✖︎✖︎`)} Can't initialize ` +
    `${brightYellow('git')} for ${cyan(projectName)}:\n` +
    `${red(error.message || error.toString())}`
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
    `${red(`✖︎✖︎✖︎`)} ` +
    `Command ${gitCommand} ${gitArgs.join(' ')} ` +
    `failed with exit code ${code}`
  )
}

export function installingDependenciesProcessError(
  projectName: string,
  error: any
) {
  return (
    `${red(`✖︎✖︎✖︎`)} Child process error: Can't ` +
    `install dependencies for ${cyan(projectName)}:\n${red(error)}`
  )
}

export function cantInstallDependencies(projectName: string, error: any) {
  return (
    `${red(`✖︎✖︎✖︎`)} Can't install dependencies for ${cyan(projectName)}:\n` +
    `${red(error.message || error.toString())}`
  )
}

export function symlinkCreated() {
  return 'Symlink created successfully.'
}

export function symlinkError(command: string, args: string[]) {
  return `${red(`✖︎✖︎✖︎`)} Failed to create symlink: ${red(command)} ${red(args.join(' '))}`
}

export function writingPackageJsonMetadata() {
  return `📝 - Writing ${brightYellow(`package.json`)} metadata...`
}

export function writingPackageJsonMetadataError(
  projectName: string,
  error: any
) {
  return (
    `${red(`✖︎✖︎✖︎`)} Can't write ` +
    `${brightYellow(`package.json`)} for ${cyan(projectName)}:\n${red(error)}`
  )
}

export function writingManifestJsonMetadata() {
  return `📜 - Writing ${brightYellow(`manifest.json`)} metadata...`
}

export function writingManifestJsonMetadataError(
  projectName: string,
  error: any
) {
  return (
    `${red(`✖︎✖︎✖︎`)} Can't write ` +
    `${brightYellow(`manifest.json`)} for ${cyan(projectName)}:\n${red(error)}`
  )
}

export function writingReadmeMetaData() {
  return `📄 - Writing ${brightYellow(`README.md`)} metadata...`
}

export function writingGitIgnore() {
  return `🙈 - Writing ${brightYellow(`.gitignore`)} lines...`
}

export function writingReadmeMetaDataEError(projectName: string, error: any) {
  return (
    `${red(`✖︎✖︎✖︎`)} ` +
    `Can't write the ${brightYellow('README.md')} file ` +
    `for ${cyan(projectName)}:\n${red(error)}`
  )
}

export function folderExists(projectName: string) {
  return `🤝 - Ensuring ${cyan(projectName)} folder exists...`
}

export function writingDirectoryError(error: any) {
  return (
    `${red(`✖︎✖︎✖︎`)} ` +
    'Error while checking directory writability:\n' +
    red(error)
  )
}
