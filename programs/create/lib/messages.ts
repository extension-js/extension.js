//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as path from 'node:path'
import colors from 'pintor'
import {fmt, prefix} from './messaging'
import {resolveScaffoldPackageManager} from './package-manager'

export function destinationNotWriteable(workingDir: string) {
  const workingDirFolder = path.basename(workingDir)

  return (
    `${prefix('error')} Couldn't write to the destination directory.\n` +
    `${fmt.label('PATH')} ${fmt.val(workingDirFolder)}\n` +
    `${colors.red('Choose a writable path, or update the folder permissions.')}`
  )
}

export async function directoryHasConflicts(
  projectPath: string,
  conflictingFiles: string[]
) {
  const projectName = path.basename(projectPath)

  let message =
    `${prefix('error')} ${colors.blue(projectName)} already contains files that would be overwritten.\n` +
    `${fmt.label('PATH')} ${fmt.val(projectPath)}\n`

  for (const file of conflictingFiles) {
    message += `   ${colors.yellow('-')} ${colors.yellow(file)}\n`
  }

  message += `${colors.red('Remove or rename them, or choose a different directory name.')}`

  return message
}

export function noProjectName() {
  return (
    `${prefix('error')} A project name is required.\n` +
    `${colors.red('Pass a name, for example')} ${colors.blue('extension create my-extension')}.\n` +
    `${colors.red('Run')} ${colors.blue('extension create --help')} ${colors.red('for the full usage.')}`
  )
}

export function noUrlAllowed() {
  return (
    `${prefix('error')} A URL is not a valid project path.\n` +
    `${colors.red('Pass a project name or a local directory path.')}`
  )
}

export async function scaffoldReady(
  projectPath: string,
  projectName: string,
  depsInstalled: boolean
) {
  const relativePath = path.relative(process.cwd(), projectPath)
  const pm = resolveScaffoldPackageManager()

  let command = 'npm run dev'
  let installCmd = 'npm install'

  switch (pm) {
    case 'deno':
      // Deno runs package.json scripts via `deno task`, not `deno run`.
      command = 'deno task dev'
      installCmd = 'deno install'
      break
    case 'yarn':
      command = 'yarn dev'
      installCmd = 'yarn'
      break
    case 'pnpm':
      command = 'pnpm dev'
      installCmd = 'pnpm install'
      break
    case 'bun':
      command = 'bun dev'
      installCmd = 'bun install'
      break
    default:
      command = 'npm run dev'
      installCmd = 'npm install'
  }

  const runNote = `     ${colors.gray('Run the extension in a fresh browser profile.')}\n`

  const steps = depsInstalled
    ? `  1. ${colors.blue('cd')} ${fmt.val(relativePath)}\n` +
      `  2. ${colors.blue(command)}\n` +
      runNote
    : `  1. ${colors.blue('cd')} ${fmt.val(relativePath)}\n` +
      `  2. ${colors.blue(installCmd)}\n` +
      `  3. ${colors.blue(command)}\n` +
      runNote

  return (
    `${prefix('success')} ${colors.blue(projectName)} is ready.\n\n` +
    `Next steps:\n` +
    steps
  )
}

export function startingNewExtension(projectName: string) {
  return `${prefix('info')} Creating the extension ${colors.blue(projectName)}…`
}

export function createDirectoryError(projectName: string, error: unknown) {
  return (
    `${prefix('error')} Couldn't create the directory ${colors.blue(projectName)}.\n` +
    `${fmt.label('REASON')} ${fmt.val(fmt.truncate(String(error)))}\n` +
    `${colors.red('Check the path and its permissions, then try again.')}`
  )
}

export function writingTypeDefinitions(projectName: string) {
  return `${prefix('debug')} create types name=${projectName}`
}

export function writingTypeDefinitionsError(error: unknown) {
  return (
    `${prefix('error')} Couldn't write the extension type definitions.\n` +
    `${fmt.label('REASON')} ${fmt.val(fmt.truncate(String(error)))}\n` +
    `${colors.red('Check the file permissions, then try again.')}`
  )
}

export function installingFromTemplate(
  projectName: string,
  templateName: string
) {
  if (templateName === 'init' || templateName === 'javascript') {
    return `${prefix('info')} Copying the template files…`
  }

  return `${prefix('info')} Copying the template ${colors.blue(templateName)}…`
}

export function installingFromTemplateError(template: string, error: unknown) {
  return (
    `${prefix('error')} Couldn't find the template ${colors.blue(template)}.\n` +
    `${fmt.label('REASON')} ${fmt.val(fmt.truncate(String(error)))}\n` +
    `${colors.red('Choose a template name from')} ${colors.blue('extension create --help')}${colors.red(', or pass a GitHub URL.')}`
  )
}

export function templateFetchTimedOut(templateName: string, ms: number) {
  return (
    `${prefix('error')} Couldn't fetch the template ` +
    `${colors.blue(templateName)} within ` +
    `${Math.round(ms / 1000)}s.\n` +
    `${colors.red('- Check your network connection.')}\n` +
    `${colors.red('- Set')} ${colors.blue('EXTENSION_CREATE_TIMEOUT_MS')} ${colors.red('to allow more time.')}`
  )
}

// A genuine "this slug is not in the catalog", distinct from a download/timeout
// failure, which the old code mislabelled as "template not found" (#56).
export function templateNotFoundInCatalog(
  templateName: string,
  error?: unknown
) {
  return (
    `${prefix('error')} The template ${colors.blue(templateName)} ` +
    `is not in the extension-js/examples catalog.\n` +
    (error
      ? `${fmt.label('REASON')} ${fmt.val(fmt.truncate(String(error)))}\n`
      : '') +
    `${colors.red('- Run')} ${colors.blue('extension create --help')} ${colors.red('to list the valid template names.')}\n` +
    `${colors.red('- Pass a GitHub URL to use a template from anywhere.')}`
  )
}

// The template exists but the DOWNLOAD failed (network, rate limit, 5xx, a git
// credential-helper hang); surface the real cause, not "choose a valid template".
export function templateDownloadFailed(templateName: string, error: unknown) {
  return (
    `${prefix('error')} Couldn't download the template ${colors.blue(templateName)} ` +
    `from ${fmt.val('github.com/extension-js/examples')}.\n` +
    `${fmt.label('REASON')} ${fmt.val(fmt.truncate(String((error as Error | undefined)?.message || error)))}\n` +
    `${colors.red('- Check your network connection and any GitHub rate limit, then try again.')}\n` +
    `${colors.red('- Set')} ${colors.blue('EXTENSION_CREATE_TIMEOUT_MS')} ${colors.red('to allow more time.')}`
  )
}

export function initializingGitForRepository(projectName: string) {
  return `${prefix('debug')} create git init name=${projectName}`
}

export function initializingGitSkipped(projectName: string, reason: string) {
  return (
    `${prefix('warn')} Skipping the git init for ${colors.blue(projectName)}.\n` +
    `${fmt.label('REASON')} ${fmt.val(reason)}\n` +
    `Run ${colors.blue('git init')} yourself if you want version control.`
  )
}

export function installingDependencies() {
  return (
    `${prefix('info')} Installing the dependencies…\n` +
    `${colors.gray('This can take a moment.')}`
  )
}

export function foundSpecializedDependencies(count: number) {
  return `${prefix('debug')} create integrations count=${count}`
}

export function installingProjectIntegrations(integrations: string[]) {
  if (integrations.length === 0) {
    return (
      `${prefix('info')} Installing the dependencies for the project tooling…\n` +
      `${colors.gray('This can take a moment.')}`
    )
  }
  const formatList = (items: string[]) => {
    if (items.length === 1) return items[0]
    if (items.length === 2) return `${items[0]} and ${items[1]}`
    return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`
  }
  const tools = formatList(integrations.map((name) => colors.blue(name)))
  return (
    `${prefix('info')} Installing the dependencies for ${tools}…\n` +
    `${colors.gray('This can take a moment.')}`
  )
}

export function installingDependenciesFailed(
  pmCommand: string,
  pmArgs: string[],
  code: number | null
) {
  return (
    `${prefix('error')} The command ${colors.blue(`${pmCommand} ${pmArgs.join(' ')}`)} ` +
    `failed with exit code ${String(code)}.\n` +
    `${colors.red('Run it yourself to see the full error.')}`
  )
}

export function installingDependenciesProcessError(
  projectName: string,
  error: unknown
) {
  return (
    `${prefix('error')} The install process for ${colors.blue(projectName)} exited unexpectedly.\n` +
    `${fmt.label('REASON')} ${fmt.val(fmt.truncate(String(error)))}\n` +
    `${colors.red('Run the install command yourself to see the full error.')}`
  )
}

export function cantInstallDependencies(projectName: string, error: unknown) {
  return (
    `${prefix('error')} Couldn't install the dependencies for ${colors.blue(projectName)}.\n` +
    `${fmt.label('REASON')} ${fmt.val(fmt.truncate(String((error as Error | undefined)?.message || error)))}\n` +
    `${colors.red('Check your package manager settings, then try again.')}`
  )
}

export function writingPackageJsonMetadata() {
  return `${prefix('debug')} create write file=package.json`
}

export function writingPackageJsonMetadataError(error: unknown) {
  return (
    `${prefix('error')} Couldn't write ${colors.blue('package.json')}.\n` +
    `${fmt.label('REASON')} ${fmt.val(fmt.truncate(String(error)))}\n` +
    `${colors.red('Check the file permissions, then try again.')}`
  )
}

export function writingDenoJsonc() {
  return `${prefix('debug')} create write file=deno.jsonc`
}

export function writingDenoJsoncError(error: unknown) {
  return (
    `${prefix('error')} Couldn't write ${colors.blue('deno.jsonc')}.\n` +
    `${fmt.label('REASON')} ${fmt.val(fmt.truncate(String(error)))}\n` +
    `${colors.red('Check the file permissions, then try again.')}`
  )
}

export function writingTemplateProvenance() {
  return `${prefix('debug')} create write file=.extension-create.json`
}

export function writingTemplateProvenanceError(error: unknown) {
  return (
    `${prefix('warn')} Couldn't write ${colors.blue('.extension-create.json')}.\n` +
    `${fmt.label('REASON')} ${fmt.val(fmt.truncate(String(error)))}\n` +
    `The project is fine. Only the template provenance record is missing.`
  )
}

export function writingManifestJsonMetadata() {
  return `${prefix('debug')} create write file=manifest.json`
}

export function writingManifestJsonMetadataError(error: unknown) {
  return (
    `${prefix('error')} Couldn't write ${colors.blue('manifest.json')}.\n` +
    `${fmt.label('REASON')} ${fmt.val(fmt.truncate(String(error)))}\n` +
    `${colors.red('Check the file permissions, then try again.')}`
  )
}

export function writingReadmeMetaData() {
  return `${prefix('debug')} create write file=README.md`
}

export function writingGitIgnore() {
  return `${prefix('debug')} create write file=.gitignore`
}

export function writingReadmeMetaDataError(error: unknown) {
  return (
    `${prefix('error')} Couldn't write ${colors.blue('README.md')}.\n` +
    `${fmt.label('REASON')} ${fmt.val(fmt.truncate(String(error)))}\n` +
    `${colors.red('Check the file permissions, then try again.')}`
  )
}

export function writingDirectoryError(error: unknown) {
  return (
    `${prefix('error')} Couldn't check whether the directory is writable.\n` +
    `${fmt.label('REASON')} ${fmt.val(fmt.truncate(String(error)))}\n` +
    `${colors.red('Check the path and its permissions, then try again.')}`
  )
}

export function cantSetupBuiltInTests(error: unknown) {
  return (
    `${prefix('error')} Couldn't set up the built-in tests.\n` +
    `${fmt.label('REASON')} ${fmt.val(fmt.truncate(String(error)))}\n` +
    `${colors.red('The extension itself is fine. Re-run')} ${colors.blue('extension create')}${colors.red(', or skip the tests.')}`
  )
}
