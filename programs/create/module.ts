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
  resolveProjectPackageManager,
  type ScaffoldPackageManager
} from './lib/package-manager'
import * as utils from './lib/utils'
import {createDirectory} from './steps/create-directory'
import {generateExtensionTypes} from './steps/generate-extension-types'
import {
  DEFAULT_TEMPLATE_NAME,
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
import {writeStoreMetadata} from './steps/write-store-metadata'
import {writeTemplateProvenance} from './steps/write-template-provenance'

// Re-exported so the CLI's template listing and the resolver that actually
// downloads a template read the SAME table. Two copies would drift, and the
// drift would show up as a name the help text offers and create cannot fetch.
export {
  resolveTemplateAlias,
  TEMPLATE_ALIASES
} from './steps/import-external-template'

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
  {cliVersion, template, install = false, logger = console}: CreateOptions
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
  const templateProvenance = await importExternalTemplate(
    projectPath,
    projectName,
    effectiveTemplate,
    logger,
    // createDirectory mkdirs the path before the import runs, so only its
    // sentinel can tell failure cleanup whether the directory is ours.
    // Unknown ownership (a mocked step) defaults to the safe side.
    {
      ownsProjectDir: createResult?.directoryCreated ?? false,
      allowOfflineFallback: templateWasOmitted
    }
  )

  if (templateProvenance?.template) {
    logger.log(
      messages.usingTemplate(
        templateProvenance.template,
        templateProvenance.source
      )
    )
  }

  // Downstream steps must reflect what actually landed on disk, not what was
  // requested: an offline fallback scaffolds the bundled template, so its
  // package.json flavor and type generation follow the real scaffold.
  const scaffoldedTemplate = templateProvenance?.template ?? effectiveTemplate

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
      {template: scaffoldedTemplate, cliVersion, packageManager},
      logger
    )
    await writeDenoJsonc(projectPath, {template: scaffoldedTemplate}, logger)
  }

  await writeTemplateProvenance(projectPath, templateProvenance, logger)

  if (install) {
    await installDependencies(projectPath, projectName, logger, packageManager)
    await installInternalDependencies(projectPath, logger)
  }

  await writeReadmeFile(projectPath, projectName, logger)
  const templateManifestName = await writeManifestJson(projectPath, logger)
  await writeStoreMetadata(
    projectPath,
    projectName,
    templateManifestName,
    logger
  )
  await writeGitignore(projectPath, logger)
  await setupBuiltInTests(projectPath, logger)

  if (utils.isTypeScriptTemplate(scaffoldedTemplate)) {
    await generateExtensionTypes(projectPath, projectName, logger)
  }

  await initializeGitRepository(
    projectPath,
    projectName,
    templateProvenance?.template,
    logger
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
    // the request, this one reports the result. With the offline fallback
    // the scaffolded template is the result even when no provenance exists.
    template: templateProvenance?.template ?? scaffoldedTemplate,
    depsInstalled: install,
    packageManager,
    templateProvenance
  }
}
