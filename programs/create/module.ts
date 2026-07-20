//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as path from 'node:path'
import * as messages from './lib/messages'
import {
  isDenoRuntime,
  resolveScaffoldPackageManager,
  type ScaffoldPackageManager
} from './lib/package-manager'
import * as utils from './lib/utils'
import {createDirectory} from './steps/create-directory'
import {generateExtensionTypes} from './steps/generate-extension-types'
import {importExternalTemplate} from './steps/import-external-template'
import {initializeGitRepository} from './steps/initialize-git-repository'
import {installDependencies} from './steps/install-dependencies'
import {installInternalDependencies} from './steps/install-internal-deps'
import {setupBuiltInTests} from './steps/setup-built-in-tests'
import {writeDenoJsonc} from './steps/write-deno-jsonc'
import {writeGitignore} from './steps/write-gitignore'
import {writeManifestJson} from './steps/write-manifest-json'
import {overridePackageJson} from './steps/write-package-json'
import {writeReadmeFile} from './steps/write-readme-file'

export interface CreateLogger {
  log: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
}

export interface CreateOptions {
  template?: string
  install?: boolean
  cliVersion?: string
  logger?: CreateLogger
}

export interface CreateResult {
  projectPath: string
  projectName: string
  template: string
  depsInstalled: boolean
  // The package manager the scaffold was created with, the one used to install
  // dependencies (when `install: true`) and the one whose commands the printed
  // next-steps reference (when `install: false`). Programmatic hosts read this
  // to render correct next steps instead of re-deriving it from a lockfile.
  packageManager: ScaffoldPackageManager
}

export async function extensionCreate(
  projectNameInput: string | undefined,
  {
    cliVersion,
    template = 'javascript',
    install = false,
    logger = console
  }: CreateOptions
): Promise<CreateResult> {
  if (!projectNameInput) {
    throw new Error(messages.noProjectName())
  }

  if (projectNameInput.startsWith('http')) {
    throw new Error(messages.noUrlAllowed())
  }

  const projectPath = path.isAbsolute(projectNameInput)
    ? projectNameInput
    : path.join(process.cwd(), projectNameInput)

  const projectName = path.basename(projectPath)

  await createDirectory(projectPath, projectName, logger)
  await importExternalTemplate(projectPath, projectName, template, logger)

  // Deno-created scaffolds get deno.jsonc as the project manifest instead of
  // package.json (issue #482): dependencies live in `imports` as npm:
  // specifiers, which `deno install` resolves and the toolchain reads for
  // framework detection. Monorepo templates keep package.json (npm workspaces
  // have no Deno analog in our scaffold) with a tasks-only deno.jsonc beside
  // it. Both are written before install so `deno install` sees them.
  const isMonorepoTemplate = String(template).toLowerCase().includes('monorepo')
  if (isDenoRuntime() && !isMonorepoTemplate) {
    await writeDenoJsonc(
      projectPath,
      projectName,
      {template, cliVersion, primary: true},
      logger
    )
  } else {
    await overridePackageJson(
      projectPath,
      projectName,
      {template, cliVersion},
      logger
    )
    await writeDenoJsonc(projectPath, projectName, {template}, logger)
  }

  if (install) {
    await installDependencies(projectPath, projectName, logger)
    await installInternalDependencies(projectPath, logger)
  }

  await writeReadmeFile(projectPath, projectName, logger)
  await writeManifestJson(projectPath, projectName, logger)
  await initializeGitRepository(projectPath, projectName, logger)
  await writeGitignore(projectPath, logger)
  await setupBuiltInTests(projectPath, projectName, logger)

  if (utils.isTypeScriptTemplate(template)) {
    await generateExtensionTypes(projectPath, projectName, logger)
  }

  const successfulInstall = await messages.successfullInstall(
    projectPath,
    projectName,
    Boolean(install)
  )

  logger.log(successfulInstall)

  return {
    projectPath,
    projectName,
    template,
    depsInstalled: install,
    packageManager: resolveScaffoldPackageManager()
  }
}
