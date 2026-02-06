//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as path from 'path'
import * as fs from 'fs'
import colors from 'pintor'
import {detectPackageManagerFromEnv} from './package-manager'

const statusPrefix = colors.brightBlue('►►►')

export function destinationNotWriteable(workingDir: string) {
  const workingDirFolder = path.basename(workingDir)

  return (
    `${colors.red('Error')} Couldn't write to the destination directory.\n` +
    `${colors.red(
      'Next step: choose a writable path or update folder permissions.'
    )}` +
    `\n${colors.red('Path')} ${colors.underline(workingDirFolder)}`
  )
}

export async function directoryHasConflicts(
  projectPath: string,
  conflictingFiles: string[]
) {
  const projectName = path.basename(projectPath)

  let message = `Conflicting files found in ${colors.blue(projectName)}.\n\n`

  for (const file of conflictingFiles) {
    const stats = await fs.promises.lstat(path.join(projectPath, file))
    message += stats.isDirectory()
      ? `   ${colors.yellow('-')} ${colors.yellow(file)}\n`
      : `   ${colors.yellow('-')} ${colors.yellow(file)}\n`
  }

  message +=
    `\n${colors.red(
      'Next step: remove or rename the files above, or choose a different directory name.'
    )}` + `\n\nPath: ${colors.underline(projectPath)}`

  return message
}

export function noProjectName() {
  return (
    `${colors.red('Error')} Project name is required.\n` +
    `Next step: provide a project name (for example, ${colors.blue(
      'my-extension'
    )}) or run ${colors.blue('--help')} for usage.`
  )
}

export function noUrlAllowed() {
  return `${colors.red(
    'Error'
  )} URLs are not allowed as a project path.\nNext step: provide a project name or a local directory path.`
}

export async function successfullInstall(
  projectPath: string,
  projectName: string,
  depsInstalled: boolean
) {
  const relativePath = path.relative(process.cwd(), projectPath)
  const pm = detectPackageManagerFromEnv()

  let command = 'npm run'
  let installCmd = 'npm install'

  switch (pm) {
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

  const steps = depsInstalled
    ? `  1. ${colors.blue('cd')} ${colors.underline(relativePath)}\n` +
      `  2. ${colors.blue(command)} (runs a fresh browser profile with your extension loaded)\n`
    : `  1. ${colors.blue('cd')} ${colors.underline(relativePath)}\n` +
      `  2. ${colors.blue(installCmd)}\n` +
      `  3. ${colors.blue(command)} (runs a fresh browser profile with your extension loaded)\n`

  const depsNote = depsInstalled
    ? `\n${colors.gray('Dependencies installed. You can start developing now.')}\n`
    : '\n'

  return (
    `${statusPrefix} ${colors.green('Created')} ${colors.blue(projectName)}\n\n` +
    `Next steps:\n\n` +
    steps +
    depsNote
  )
}

export function startingNewExtension(projectName: string) {
  return `${statusPrefix} Creating ${colors.blue(projectName)}...`
}

export function checkingIfPathIsWriteable() {
  return `${statusPrefix} Checking if the destination path is writable...`
}

export function scanningPossiblyConflictingFiles() {
  return `${statusPrefix} Scanning for conflicting files...`
}

export function createDirectoryError(projectName: string, error: any) {
  return `${colors.red('Error')} Couldn't create directory ${colors.blue(
    projectName
  )}.\n${colors.red(String(error))}\n${colors.red(
    'Next step: check the path and permissions, then try again.'
  )}`
}

export function writingTypeDefinitions(projectName: string) {
  return `${statusPrefix} Writing type definitions for ${colors.blue(
    projectName
  )}...`
}

export function writingTypeDefinitionsError(error: any) {
  return `${colors.red(
    'Error'
  )} Couldn't write the extension type definitions.\n${colors.red(
    String(error)
  )}\n${colors.red('Next step: check file permissions, then try again.')}`
}

export function installingFromTemplate(
  projectName: string,
  templateName: string
) {
  if (templateName === 'init') {
    return `${statusPrefix} Installing ${colors.blue(projectName)}...`
  }

  return `${statusPrefix} Installing ${colors.blue(
    projectName
  )} from template ${colors.yellow(templateName)}...`
}

export function installingFromTemplateError(
  projectName: string,
  template: string,
  error: any
) {
  return `${colors.red('Error')} Couldn't find template ${colors.yellow(
    template
  )} for ${colors.blue(projectName)}.\n${colors.red(String(error))}\n${colors.red(
    'Next step: choose a valid template name or URL.'
  )}`
}

export function initializingGitForRepository(projectName: string) {
  return `${statusPrefix} Initializing git repository for ${colors.blue(
    projectName
  )}...`
}

export function initializingGitForRepositoryFailed(
  gitCommand: string,
  gitArgs: string[],
  code: number | null
) {
  return `${colors.red('Error')} Command ${colors.yellow(
    gitCommand
  )} ${colors.yellow(gitArgs.join(' '))} failed.\n${colors.red(
    `Exit code: ${colors.yellow(String(code))}`
  )}\n${colors.red('Next step: run the command manually to inspect the error.')}`
}

export function initializingGitForRepositoryProcessError(
  projectName: string,
  error: any
) {
  return `${colors.red(
    'Error'
  )} Child process failed while initializing ${colors.yellow('git')} for ${colors.blue(
    projectName
  )}.\n${colors.red(String(error?.message || error))}\n${colors.red(
    'Next step: retry initialization or create the repository manually.'
  )}`
}

export function initializingGitForRepositoryError(
  projectName: string,
  error: any
) {
  return `${colors.red('Error')} Couldn't initialize ${colors.yellow(
    'git'
  )} for ${colors.blue(projectName)}.\n${colors.red(
    String(error?.message || error)
  )}\n${colors.red(
    'Next step: retry initialization or create the repository manually.'
  )}`
}

export function installingDependencies() {
  return `${statusPrefix} Installing project-specific dependencies... ${colors.gray(
    '(This may take a moment)'
  )}`
}

export function installingBuildDependencies(dependencies: string[]) {
  return `${statusPrefix} Installing general build dependencies... ${colors.gray(
    '(This may take a moment)'
  )}`
}

export function foundSpecializedDependencies(count: number) {
  return `${statusPrefix} Found ${colors.yellow(
    String(count)
  )} specialized integration${count === 1 ? '' : 's'} needing installation...`
}

export function installingProjectIntegrations(integrations: string[]) {
  if (integrations.length === 0) {
    return `${statusPrefix} Installing specialized dependencies for ${colors.gray(
      'project tooling'
    )}... ${colors.gray('(This may take a moment)')}`
  }
  const formatList = (items: string[]) => {
    if (items.length === 1) return items[0]
    if (items.length === 2) return `${items[0]} and ${items[1]}`
    return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`
  }
  const tools =
    integrations.length > 0
      ? formatList(integrations.map((name) => colors.yellow(name)))
      : colors.gray('project tooling')
  return `${statusPrefix} Installing specialized dependencies for ${tools}... ${colors.gray(
    '(This may take a moment)'
  )}`
}

export function installingDependenciesFailed(
  gitCommand: string,
  gitArgs: string[],
  code: number | null
) {
  return `${colors.red('Error')} Command ${colors.yellow(
    gitCommand
  )} ${colors.yellow(gitArgs.join(' '))} failed.\n${colors.red(
    `Exit code: ${colors.yellow(String(code))}`
  )}\n${colors.red('Next step: run the command manually to inspect the error.')}`
}

export function installingDependenciesProcessError(
  projectName: string,
  error: any
) {
  return `${colors.red(
    'Error'
  )} Child process failed while installing dependencies for ${colors.blue(
    projectName
  )}.\n${colors.red(String(error))}\n${colors.red(
    'Next step: run the install command manually to inspect the error.'
  )}`
}

export function cantInstallDependencies(projectName: string, error: any) {
  return `${colors.red('Error')} Couldn't install dependencies for ${colors.blue(
    projectName
  )}.\n${colors.red(String(error?.message || error))}\n${colors.red(
    'Next step: check your package manager settings, then try again.'
  )}`
}

export function writingPackageJsonMetadata() {
  return `${statusPrefix} Writing ${colors.yellow('package.json')}...`
}

export function writingPackageJsonMetadataError(
  projectName: string,
  error: any
) {
  return `${colors.red('Error')} Couldn't write ${colors.yellow(
    'package.json'
  )} for ${colors.blue(projectName)}.\n${colors.red(
    String(error)
  )}\n${colors.red('Next step: check file permissions, then try again.')}`
}

export function writingManifestJsonMetadata() {
  return `${statusPrefix} Writing ${colors.yellow('manifest.json')}...`
}

export function writingManifestJsonMetadataError(
  projectName: string,
  error: any
) {
  return `${colors.red('Error')} Couldn't write ${colors.yellow(
    'manifest.json'
  )} for ${colors.blue(projectName)}.\n${colors.red(
    String(error)
  )}\n${colors.red('Next step: check file permissions, then try again.')}`
}

export function writingReadmeMetaData() {
  return `${statusPrefix} Writing ${colors.yellow('README.md')}...`
}

export function writingGitIgnore() {
  return `${statusPrefix} Writing ${colors.yellow('.gitignore')}...`
}

export function writingReadmeMetaDataEError(projectName: string, error: any) {
  return `${colors.red('Error')} Couldn't write ${colors.yellow(
    'README.md'
  )} for ${colors.blue(projectName)}.\n${colors.red(
    String(error)
  )}\n${colors.red('Next step: check file permissions, then try again.')}`
}

export function folderExists(projectName: string) {
  return `${statusPrefix} Ensuring ${colors.blue(projectName)} exists...`
}

export function writingDirectoryError(error: any) {
  return `${colors.red(
    'Error'
  )} Couldn't check directory writability.\n${colors.red(
    String(error)
  )}\n${colors.red('Next step: check the path and permissions, then try again.')}`
}

export function cantSetupBuiltInTests(projectName: string, error: any) {
  return `${colors.red(
    'Error'
  )} Couldn't set up built-in tests for ${colors.yellow(projectName)}.\n${colors.red(
    String(error)
  )}\n${colors.red('Next step: run the setup step again or skip tests.')}`
}
