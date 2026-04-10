//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as path from 'path'
import * as messages from './lib/messages'
import * as utils from './lib/utils'
import {createDirectory} from './steps/create-directory'
import {importExternalTemplate} from './steps/import-external-template'
import {overridePackageJson} from './steps/write-package-json'
import {installDependencies} from './steps/install-dependencies'
import {writeReadmeFile} from './steps/write-readme-file'
import {writeManifestJson} from './steps/write-manifest-json'
import {generateExtensionTypes} from './steps/generate-extension-types'
import {writeGitignore} from './steps/write-gitignore'
import {initializeGitRepository} from './steps/initialize-git-repository'
import {setupBuiltInTests} from './steps/setup-built-in-tests'
import {installInternalDependencies} from './steps/install-internal-deps'

export interface CreateLogger {
  log: (...args: any[]) => void
  error: (...args: any[]) => void
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

  try {
    await createDirectory(projectPath, projectName, logger)
    await importExternalTemplate(projectPath, projectName, template, logger)
    await overridePackageJson(
      projectPath,
      projectName,
      {template, cliVersion},
      logger
    )

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
      depsInstalled: install
    }
  } catch (error) {
    throw error
  }
}
