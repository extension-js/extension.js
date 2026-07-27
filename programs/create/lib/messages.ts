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
    `${colors.red('Choose a writable path, or update the folder permissions.')}\n` +
    `${fmt.label('PATH')} ${fmt.val(workingDirFolder)}`
  )
}

export async function directoryHasConflicts(
  projectPath: string,
  conflictingFiles: string[]
) {
  const projectName = path.basename(projectPath)

  // The remedy sits above the list: the first two lines are the whole message
  // and the files below them are evidence, not instruction.
  let message =
    `${prefix('error')} ${colors.blue(projectName)} already contains files that would be overwritten.\n` +
    `${colors.red('Remove or rename them, or choose a different directory name.')}\n\n`

  for (const file of conflictingFiles) {
    message += `   ${colors.yellow('-')} ${colors.yellow(file)}\n`
  }

  message += `\n${fmt.label('PATH')} ${fmt.val(projectPath)}`

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

export async function successfullInstall(
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
  return `${prefix('info')} Create the extension ${colors.blue(projectName)}.`
}

export function createDirectoryError(projectName: string, error: unknown) {
  return (
    `${prefix('error')} Couldn't create the directory ${colors.blue(projectName)}.\n` +
    `${colors.red('Check the path and its permissions, then try again.')}\n` +
    `${colors.red(String(error))}`
  )
}

export function writingTypeDefinitions(projectName: string) {
  return `${prefix('debug')} create types name=${projectName}`
}

export function writingTypeDefinitionsError(error: unknown) {
  return (
    `${prefix('error')} Couldn't write the extension type definitions.\n` +
    `${colors.red('Check the file permissions, then try again.')}\n` +
    `${colors.red(String(error))}`
  )
}

export function installingFromTemplate(
  projectName: string,
  templateName: string
) {
  if (templateName === 'init' || templateName === 'javascript') {
    return `${prefix('info')} Install ${colors.blue(projectName)}.`
  }

  return `${prefix('info')} Install ${colors.blue(projectName)} from the template ${colors.yellow(templateName)}.`
}

export function installingFromTemplateError(
  projectName: string,
  template: string,
  error: unknown
) {
  return (
    `${prefix('error')} Couldn't find the template ${colors.yellow(template)}.\n` +
    `${colors.red('Choose a template name from')} ${colors.blue('extension create --help')}${colors.red(', or pass a GitHub URL.')}\n` +
    `${colors.red(String(error))}`
  )
}

export function templateFetchTimedOut(templateName: string, ms: number) {
  return (
    `${prefix('error')} Timed out after ` +
    `${colors.yellow(`${Math.round(ms / 1000)}s`)} ` +
    `fetching the template ${colors.yellow(templateName)}.\n` +
    `${colors.red('Check your network connection.')}\n` +
    `${colors.red('Set EXTENSION_CREATE_TIMEOUT_MS to allow more time.')}`
  )
}

// A genuine "this slug is not in the catalog", distinct from a download/timeout
// failure, which the old code mislabelled as "template not found" (#56).
export function templateNotFoundInCatalog(
  templateName: string,
  error?: unknown
) {
  return (
    `${prefix('error')} The template ${colors.yellow(templateName)} ` +
    `is not in the extension-js/examples catalog.\n` +
    `${colors.red('Run')} ${colors.blue('extension create --help')} ${colors.red('to list the valid template names.')}\n` +
    `${colors.red('Or pass a GitHub URL to use a template from anywhere.')}` +
    (error ? `\n${colors.red(String(error))}` : '')
  )
}

// The template exists but the DOWNLOAD failed (network, rate limit, 5xx, a git
// credential-helper hang); surface the real cause, not "choose a valid template".
export function templateDownloadFailed(templateName: string, error: unknown) {
  return (
    `${prefix('error')} Couldn't download the template ${colors.yellow(templateName)} ` +
    `from ${colors.yellow('github.com/extension-js/examples')}.\n` +
    `${colors.red('Check your network connection and any GitHub rate limit, then try again.')}\n` +
    `${colors.red('Set EXTENSION_CREATE_TIMEOUT_MS to allow more time.')}\n` +
    `${colors.red(String((error as Error | undefined)?.message || error))}`
  )
}

export function initializingGitForRepository(projectName: string) {
  return `${prefix('debug')} create git init name=${projectName}`
}

export function initializingGitSkipped(projectName: string, reason: string) {
  return (
    `${prefix('warn')} Skip the git init for ${colors.blue(projectName)}.\n` +
    `${fmt.label('REASON')} ${colors.yellow(reason)}\n` +
    `Run ${colors.yellow('git init')} yourself if you want version control.`
  )
}

export function installingDependencies() {
  return (
    `${prefix('info')} Install the project dependencies.\n` +
    `${colors.gray('This can take a moment.')}`
  )
}

export function foundSpecializedDependencies(count: number) {
  return `${prefix('debug')} create integrations count=${count}`
}

export function installingProjectIntegrations(integrations: string[]) {
  if (integrations.length === 0) {
    return (
      `${prefix('info')} Install the dependencies for the ${colors.gray('project tooling')}.\n` +
      `${colors.gray('This can take a moment.')}`
    )
  }
  const formatList = (items: string[]) => {
    if (items.length === 1) return items[0]
    if (items.length === 2) return `${items[0]} and ${items[1]}`
    return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`
  }
  const tools = formatList(integrations.map((name) => colors.yellow(name)))
  return (
    `${prefix('info')} Install the dependencies for ${tools}.\n` +
    `${colors.gray('This can take a moment.')}`
  )
}

export function installingDependenciesFailed(
  gitCommand: string,
  gitArgs: string[],
  code: number | null
) {
  return (
    `${prefix('error')} The command ${colors.yellow(gitCommand)} ${colors.yellow(gitArgs.join(' '))} ` +
    `failed with exit code ${colors.yellow(String(code))}.\n` +
    `${colors.red('Run it yourself to see the full error.')}`
  )
}

export function installingDependenciesProcessError(
  projectName: string,
  error: unknown
) {
  return (
    `${prefix('error')} The install process for ${colors.blue(projectName)} exited unexpectedly.\n` +
    `${colors.red('Run the install command yourself to see the full error.')}\n` +
    `${colors.red(String(error))}`
  )
}

export function cantInstallDependencies(projectName: string, error: unknown) {
  return (
    `${prefix('error')} Couldn't install the dependencies for ${colors.blue(projectName)}.\n` +
    `${colors.red('Check your package manager settings, then try again.')}\n` +
    `${colors.red(String((error as Error | undefined)?.message || error))}`
  )
}

export function writingPackageJsonMetadata() {
  return `${prefix('debug')} create write file=package.json`
}

// projectName is unused now that the path names the project; the parameter
// stays so the exported arity holds against the message catalog snapshot.
export function writingPackageJsonMetadataError(
  projectName: string,
  error: unknown
) {
  return (
    `${prefix('error')} Couldn't write ${colors.yellow('package.json')}.\n` +
    `${colors.red('Check the file permissions, then try again.')}\n` +
    `${colors.red(String(error))}`
  )
}

export function writingDenoJsonc() {
  return `${prefix('debug')} create write file=deno.jsonc`
}

export function writingDenoJsoncError(projectName: string, error: unknown) {
  return (
    `${prefix('error')} Couldn't write ${colors.yellow('deno.jsonc')}.\n` +
    `${colors.red('Check the file permissions, then try again.')}\n` +
    `${colors.red(String(error))}`
  )
}

export function writingTemplateProvenance() {
  return `${prefix('debug')} create write file=.extension-create.json`
}

export function writingTemplateProvenanceError(error: unknown) {
  return (
    `${prefix('warn')} Couldn't write ${colors.yellow('.extension-create.json')}.\n` +
    `The project is fine; only the template provenance record is missing.\n` +
    `${colors.yellow(String(error))}`
  )
}

export function writingManifestJsonMetadata() {
  return `${prefix('debug')} create write file=manifest.json`
}

export function writingManifestJsonMetadataError(
  projectName: string,
  error: unknown
) {
  return (
    `${prefix('error')} Couldn't write ${colors.yellow('manifest.json')}.\n` +
    `${colors.red('Check the file permissions, then try again.')}\n` +
    `${colors.red(String(error))}`
  )
}

export function writingReadmeMetaData() {
  return `${prefix('debug')} create write file=README.md`
}

export function writingGitIgnore() {
  return `${prefix('debug')} create write file=.gitignore`
}

export function writingReadmeMetaDataEError(
  projectName: string,
  error: unknown
) {
  return (
    `${prefix('error')} Couldn't write ${colors.yellow('README.md')}.\n` +
    `${colors.red('Check the file permissions, then try again.')}\n` +
    `${colors.red(String(error))}`
  )
}

export function writingDirectoryError(error: unknown) {
  return (
    `${prefix('error')} Couldn't check whether the directory is writable.\n` +
    `${colors.red('Check the path and its permissions, then try again.')}\n` +
    `${colors.red(String(error))}`
  )
}

export function cantSetupBuiltInTests(projectName: string, error: unknown) {
  return (
    `${prefix('error')} Couldn't set up the built-in tests.\n` +
    `${colors.red('The extension itself is fine. Re-run create, or skip the tests.')}\n` +
    `${colors.red(String(error))}`
  )
}
