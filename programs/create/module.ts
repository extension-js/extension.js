//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as path from 'node:path'
import * as messages from './lib/messages'
import {card} from './lib/messaging'
import {
  isDenoRuntime,
  resolveScaffoldPackageManager,
  type ScaffoldPackageManager
} from './lib/package-manager'
import * as utils from './lib/utils'
import {createDirectory} from './steps/create-directory'
import {generateExtensionTypes} from './steps/generate-extension-types'
import {
  importExternalTemplate,
  type TemplateProvenance
} from './steps/import-external-template'
import {initializeGitRepository} from './steps/initialize-git-repository'
import {installDependencies} from './steps/install-dependencies'
import {installInternalDependencies} from './steps/install-internal-deps'
import {setupBuiltInTests} from './steps/setup-built-in-tests'
import {writeDenoJsonc} from './steps/write-deno-jsonc'
import {writeGitignore} from './steps/write-gitignore'
import {writeManifestJson} from './steps/write-manifest-json'
import {overridePackageJson} from './steps/write-package-json'
import {writeReadmeFile} from './steps/write-readme-file'
import {writeTemplateProvenance} from './steps/write-template-provenance'

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
  // The package manager the scaffold was created with; programmatic hosts read
  // this to render correct next steps instead of re-deriving from a lockfile.
  packageManager: ScaffoldPackageManager
  // Which template corpus the scaffold was cut from (ref/source), also stamped
  // into the project as `.extension-create.json` for reproducibility.
  templateProvenance: TemplateProvenance
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

  // The card is the session header, printed before the first step line and
  // through the injected logger so programmatic hosts keep capturing it.
  const updateSuffix = process.env.EXTENSION_CLI_UPDATE_SUFFIX || ''
  if (updateSuffix) delete process.env.EXTENSION_CLI_UPDATE_SUFFIX
  logger.log(' ')
  logger.log(
    card({
      version: cliVersion || process.env.EXTENSION_CLI_VERSION,
      suffix: updateSuffix,
      rows: [
        {label: 'Extension', value: projectName},
        {label: 'Output', value: projectPath}
      ]
    })
  )
  logger.log(' ')
  process.env.EXTENSION_CLI_BANNER_PRINTED = 'true'

  await createDirectory(projectPath, projectName, logger)
  const templateProvenance = await importExternalTemplate(
    projectPath,
    projectName,
    template,
    logger
  )

  // Deno-created scaffolds get deno.jsonc instead of package.json (issue #482);
  // monorepo templates keep package.json with a tasks-only deno.jsonc beside it.
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

  // Stamp provenance before git init so the record is part of the first commit.
  await writeTemplateProvenance(projectPath, templateProvenance, logger)

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
    packageManager: resolveScaffoldPackageManager(),
    templateProvenance
  }
}
