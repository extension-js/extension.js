//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import type {InstallRunner} from './lib/install-runner'
import * as messages from './lib/messages'
import {card} from './lib/messaging'
import {
  isDenoRuntime,
  resolveProjectPackageManager,
  type VersionProbe
} from './lib/package-manager'
import {isUrlProjectName} from './lib/project-name'
import * as utils from './lib/utils'
import type {CreateLogger, CreateOptions, CreateResult} from './module'
import {createDirectory} from './steps/create-directory'
import {generateExtensionTypes} from './steps/generate-extension-types'
import {
  cleanupFailedImport,
  DEFAULT_TEMPLATE_NAME,
  importExternalTemplate,
  noteIncompleteCleanup,
  type RemovePath
} from './steps/import-external-template'
import {
  type GitStepOptions,
  initializeGitRepository
} from './steps/initialize-git-repository'
import {installDependencies} from './steps/install-dependencies'
import {
  type DependencyResolver,
  installInternalDependencies
} from './steps/install-internal-deps'
import {setupBuiltInTests} from './steps/setup-built-in-tests'
import {writeDenoJsonc} from './steps/write-deno-jsonc'
import {writeGitignore} from './steps/write-gitignore'
import {writeManifestJson} from './steps/write-manifest-json'
import {overridePackageJson} from './steps/write-package-json'
import {writeReadmeFile} from './steps/write-readme-file'
import {writeStoreMetadata} from './steps/write-store-metadata'
import {writeTemplateProvenance} from './steps/write-template-provenance'

// How a create reaches package managers and git. Kept off CreateOptions so the
// published surface has no seam, and omitted in production for the defaults.
export interface CreateSeams {
  runInstall?: InstallRunner
  probeVersion?: VersionProbe
  canResolveDependency?: DependencyResolver
  cwd?: string
  git?: GitStepOptions
  // How failure cleanup removes a path, fs.rm unless given.
  remove?: RemovePath
}

export async function runCreate(
  projectNameInput: string | undefined,
  {cliVersion, template, install = false, logger = console}: CreateOptions,
  seams: CreateSeams = {}
): Promise<CreateResult> {
  if (!projectNameInput) {
    throw new Error(messages.noProjectName())
  }

  // An omitted template takes the default, which downloads; only that case is
  // allowed to fall back to the bundled offline template, because an explicit
  // name that fails to download should fail loudly rather than swap silently.
  const templateWasOmitted =
    template === undefined ||
    template === null ||
    String(template).trim() === ''
  const effectiveTemplate = templateWasOmitted
    ? DEFAULT_TEMPLATE_NAME
    : String(template)

  if (isUrlProjectName(projectNameInput)) {
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

  // The card names exactly what the user asked for. The alias that once
  // rewrote `init` to `javascript` here is gone, a swapped name in the header
  // is the same lie as a swapped scaffold (section 126).
  const requestedTemplate = effectiveTemplate
  logger.log(' ')
  logger.log(
    card({
      version: cliVersion || process.env.EXTENSION_CLI_VERSION,
      suffix: updateSuffix,
      rows: [
        {label: 'Extension', value: projectName},
        {label: 'Template', value: requestedTemplate},
        {label: 'Output', value: projectPath}
      ]
    })
  )

  logger.log(' ')
  process.env.EXTENSION_CLI_BANNER_PRINTED = 'true'

  const createResult = await createDirectory(projectPath, projectName, logger)

  // Read before the import writes anything: every step after it personalizes
  // the scaffold, so a failure there must leave nothing half-named behind,
  // and nothing that pre-existed this run may ever be removed.
  const ownsProjectDir = createResult.directoryCreated
  const preExistingEntries = ownsProjectDir
    ? []
    : await fs.promises.readdir(projectPath).catch(() => [])
  // Cleanup keeps a pre-existing file by name only. The owner's .gitignore is
  // edited in place by the import, so its bytes are what a failure restores.
  const ownerGitignore = ownsProjectDir
    ? null
    : await fs.promises
        .readFile(path.join(projectPath, '.gitignore'))
        .catch(() => null)

  try {
    return await scaffoldProject({
      projectPath,
      projectName,
      effectiveTemplate,
      templateWasOmitted,
      ownsProjectDir,
      preExistingEntries,
      install,
      cliVersion,
      logger,
      seams
    })
  } catch (error) {
    const leftBehind = await cleanupFailedImport(
      projectPath,
      ownsProjectDir,
      preExistingEntries,
      seams.remove
    )
    const notRestored: string[] = []

    if (ownerGitignore !== null) {
      const gitignorePath = path.join(projectPath, '.gitignore')

      await fs.promises.writeFile(gitignorePath, ownerGitignore).catch(() => {
        notRestored.push(gitignorePath)
      })
    }

    // The failure is still the one thrown, and it now says what was left.
    noteIncompleteCleanup(error, {leftBehind, notRestored})

    throw error
  }
}

interface ScaffoldInput {
  projectPath: string
  projectName: string
  effectiveTemplate: string
  templateWasOmitted: boolean
  ownsProjectDir: boolean
  preExistingEntries?: readonly string[]
  install: boolean
  cliVersion?: string
  logger: CreateLogger
  seams: CreateSeams
}

async function scaffoldProject({
  projectPath,
  projectName,
  effectiveTemplate,
  templateWasOmitted,
  ownsProjectDir,
  preExistingEntries = [],
  install,
  cliVersion,
  logger,
  seams
}: ScaffoldInput): Promise<CreateResult> {
  const templateProvenance = await importExternalTemplate(
    projectPath,
    projectName,
    effectiveTemplate,
    logger,
    // createDirectory mkdirs the path before the import runs, so only its
    // sentinel can tell failure cleanup whether the directory is ours.
    {
      ownsProjectDir,
      allowOfflineFallback: templateWasOmitted,
      remove: seams.remove
    }
  )

  logger.log(
    messages.usingTemplate(
      templateProvenance.template,
      templateProvenance.source
    )
  )

  // Downstream steps must reflect what actually landed on disk, not what was
  // requested: an offline fallback scaffolds the bundled template, so its
  // package.json flavor and type generation follow the real scaffold.
  const scaffoldedTemplate = templateProvenance.template

  // One manager for the whole scaffold: declared, installed with, printed
  // in the next steps and handed back. Read once the template is on disk,
  // since a starter's own pin (or its pnpm workspace file) decides it.
  const packageManager = resolveProjectPackageManager(projectPath)

  // Deno-created scaffolds get deno.jsonc instead of package.json (issue #482);
  // monorepo templates keep package.json with a tasks-only deno.jsonc beside it.
  const isMonorepoTemplate = String(scaffoldedTemplate)
    .toLowerCase()
    .includes('monorepo')

  if (isDenoRuntime() && !isMonorepoTemplate) {
    await writeDenoJsonc(
      projectPath,
      {template: scaffoldedTemplate, cliVersion, primary: true},
      logger
    )
  } else {
    await overridePackageJson(
      projectPath,
      {
        template: scaffoldedTemplate,
        cliVersion,
        packageManager,
        probeVersion: seams.probeVersion
      },
      logger
    )

    await writeDenoJsonc(projectPath, {template: scaffoldedTemplate}, logger)
  }

  await writeTemplateProvenance(projectPath, templateProvenance, logger)

  let installSeconds: number | undefined

  if (install) {
    const installStartedAt = Date.now()
    // The requested template, not the scaffolded one: a failure names the
    // create the user would run again, and they asked for what they typed.
    const requestedTemplate = templateWasOmitted ? undefined : effectiveTemplate

    await installDependencies(
      projectPath,
      projectName,
      logger,
      packageManager,
      requestedTemplate,
      seams.runInstall
    )

    await installInternalDependencies(
      projectPath,
      logger,
      packageManager,
      requestedTemplate,
      seams.canResolveDependency,
      seams.cwd,
      seams.runInstall
    )

    installSeconds = Math.round((Date.now() - installStartedAt) / 1000)
  }

  await writeReadmeFile(projectPath, projectName, logger, packageManager)
  const templateManifestName = await writeManifestJson(projectPath, logger)
  await writeStoreMetadata(
    projectPath,
    projectName,
    templateManifestName,
    logger
  )

  // The env files a template ships stay tracked, the owner's own do not.
  await writeGitignore(projectPath, logger, {ownedEntries: preExistingEntries})
  await setupBuiltInTests(projectPath)

  if (
    await utils.scaffoldNeedsTypeDefinitions(projectPath, scaffoldedTemplate)
  ) {
    await generateExtensionTypes(projectPath, projectName, logger)
  }

  await initializeGitRepository(
    projectPath,
    projectName,
    templateProvenance.template,
    logger,
    seams.git
  )

  const readyMessage = await messages.scaffoldReady(
    projectPath,
    projectName,
    Boolean(install),
    packageManager
  )

  logger.log(readyMessage)

  return {
    projectPath,
    projectName,
    // The name the scaffold actually came from, which is what the provenance
    // file records. Reporting the raw request here made one run answer with
    // two names: `new-react` in the envelope, `newtab-react` in the project,
    // and the envelope's value absent from the CLI's own names[]. The session
    // header still echoes what was typed (section 126): that surface reports
    // the request, this one reports the result.
    template: scaffoldedTemplate,
    depsInstalled: install,
    ...(installSeconds === undefined ? {} : {installSeconds}),
    packageManager,
    templateProvenance
  }
}
