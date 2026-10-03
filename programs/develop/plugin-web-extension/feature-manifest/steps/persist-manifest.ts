// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import rspack, {Compilation, type Compiler} from '@rspack/core'
import {isCompilerRestarting} from '../../../dev-server/session-restart'
import {turnedOffPublicFolders} from '../../../plugin-special-folders/resolve-public-folder'
import {isManifestAddress} from '../../shared/paths'
import {getCurrentManifestContent} from '../manifest-lib/manifest'
import * as messages from '../messages'

function readJsonSafe(source: string) {
  try {
    return JSON.parse(source)
  } catch {
    return undefined
  }
}

function normalizeManifestFile(filePath: unknown): string | undefined {
  if (typeof filePath !== 'string') return undefined

  const normalized = filePath.trim().replace(/^\/+/, '')
  if (!normalized) return undefined
  if (isManifestAddress(filePath)) return undefined
  if (/[*?[\]{}]/.test(normalized)) return undefined

  return normalized
}

function collectRequiredManifestFiles(manifest: unknown): string[] {
  const required = new Set<string>()

  const addFile = (filePath: unknown) => {
    const normalized = normalizeManifestFile(filePath)
    if (normalized) required.add(normalized)
  }

  const manifestObj = manifest as
    | {
        background?: {
          service_worker?: unknown
          page?: unknown
          scripts?: unknown
        }
        side_panel?: {default_path?: unknown}
        content_scripts?: unknown
        action?: {default_popup?: unknown}
        browser_action?: {default_popup?: unknown}
        page_action?: {default_popup?: unknown}
        options_ui?: {page?: unknown}
        options_page?: unknown
        devtools_page?: unknown
        chrome_url_overrides?: {
          newtab?: unknown
          history?: unknown
          bookmarks?: unknown
        }
        theme_experiment?: {stylesheet?: unknown}
        chrome_settings_overrides?: {
          startup_pages?: unknown
          search_provider?: {favicon_url?: unknown}
        }
      }
    | undefined
  const background = manifestObj?.background

  addFile(background?.service_worker)
  addFile(background?.page)

  const backgroundScripts = background?.scripts

  if (Array.isArray(backgroundScripts)) {
    for (const script of backgroundScripts) addFile(script)
  }

  addFile(manifestObj?.side_panel?.default_path)

  // Load-checked HTML entry points, mirroring emit-html-file's field set.
  // sandbox.pages stays out: that tier is warn-only by design, and a guard
  // entry would turn its deliberate green-with-warning into a hard failure.
  addFile(manifestObj?.action?.default_popup)
  addFile(manifestObj?.browser_action?.default_popup)
  addFile(manifestObj?.page_action?.default_popup)
  addFile(manifestObj?.options_ui?.page)
  addFile(manifestObj?.options_page)
  addFile(manifestObj?.devtools_page)
  addFile(manifestObj?.chrome_url_overrides?.newtab)
  addFile(manifestObj?.chrome_url_overrides?.history)
  addFile(manifestObj?.chrome_url_overrides?.bookmarks)
  // Firefox theme and search overrides name packaged files too; addresses
  // are filtered by normalizeManifestFile.
  addFile(manifestObj?.theme_experiment?.stylesheet)
  addFile(manifestObj?.chrome_settings_overrides?.search_provider?.favicon_url)
  const startupPages = manifestObj?.chrome_settings_overrides?.startup_pages

  if (Array.isArray(startupPages)) {
    for (const page of startupPages) addFile(page)
  }

  const contentScripts = manifestObj?.content_scripts

  if (Array.isArray(contentScripts)) {
    for (const contentScript of contentScripts as Array<{
      js?: unknown
      css?: unknown
    }>) {
      const js = contentScript?.js

      if (Array.isArray(js)) {
        for (const jsFile of js) addFile(jsFile)
      }

      const css = contentScript?.css

      if (Array.isArray(css)) {
        for (const cssFile of css) addFile(cssFile)
      }
    }
  }

  return [...required]
}

function isFile(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isFile()
  } catch {
    return false
  }
}

// Every file the manifest names that a turned-off public folder holds. The
// JSON features rename what they read from there, so their paths count too.
function collectFilesInTurnedOffPublic(
  manifest: unknown,
  offFolders: string[]
): string[] {
  const found = new Set<string>()

  const visit = (value: unknown) => {
    if (typeof value === 'string') {
      const relative = normalizeManifestFile(value)

      if (
        relative &&
        !relative.split('/').includes('..') &&
        offFolders.some((folder) => isFile(path.join(folder, relative)))
      ) {
        found.add(relative)
      }

      return
    }

    if (value && typeof value === 'object') Object.values(value).forEach(visit)
  }

  visit(manifest)

  const named = manifest as
    | {
        declarative_net_request?: {rule_resources?: Array<{path?: unknown}>}
        storage?: {managed_schema?: unknown}
      }
    | undefined
  const rules = named?.declarative_net_request?.rule_resources
  const renamed = [
    ...(Array.isArray(rules) ? rules.map((rule) => rule?.path) : []),
    named?.storage?.managed_schema
  ]

  for (const value of renamed) {
    const relative = normalizeManifestFile(value)
    if (relative) found.add(relative)
  }

  return [...found]
}

function findMissingFilesOnDisk(
  outputPath: string,
  required: string[]
): string[] {
  const missing: string[] = []

  for (const relativeFile of required) {
    if (!fs.existsSync(path.join(outputPath, relativeFile))) {
      missing.push(relativeFile)
    }
  }

  return missing
}

function writeFileAtomically(targetPath: string, content: string) {
  const directory = path.dirname(targetPath)
  const tempPath = path.join(
    directory,
    `.manifest.${process.pid}.${Date.now()}.${Math.random()
      .toString(16)
      .slice(2)}.tmp`
  )

  fs.mkdirSync(directory, {recursive: true})

  try {
    fs.writeFileSync(tempPath, content, 'utf-8')
    fs.renameSync(tempPath, targetPath)
  } finally {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath)
    } catch {
      // Ignore
    }
  }
}

export class PersistManifestToDisk {
  constructor(private readonly options: {manifestPath?: string} = {}) {}

  apply(compiler: Compiler) {
    const {manifestPath} = this.options
    let pendingManifestSource: string | undefined
    let pendingOutputPath: string | undefined
    let pendingHadErrors = false

    compiler.hooks.thisCompilation.tap(
      'manifest:persist-manifest:capture',
      (compilation: Compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'manifest:persist-manifest:capture',
            stage: Compilation.PROCESS_ASSETS_STAGE_REPORT + 1000
          },
          () => {
            pendingHadErrors = compilation.errors.length > 0
            pendingOutputPath =
              compilation.outputOptions.path || compiler.options.output?.path

            const manifestAsset = compilation.getAsset('manifest.json')
            const manifestSource =
              getCurrentManifestContent(compilation) ||
              manifestAsset?.source?.source?.().toString()

            pendingManifestSource =
              typeof manifestSource === 'string' ? manifestSource : undefined
          }
        )
      }
    )

    compiler.hooks.afterEmit.tap(
      'manifest:persist-manifest:flush',
      (compilation: Compilation) => {
        const outputPath = pendingOutputPath
        const manifestSource = pendingManifestSource
        const hadErrors = pendingHadErrors

        pendingManifestSource = undefined
        pendingOutputPath = undefined
        pendingHadErrors = false

        if (hadErrors || !outputPath || !manifestSource) return

        const manifest = readJsonSafe(manifestSource)
        if (!manifest) return

        // With `public: false` every feature still finds a file in public/
        // and leaves the emit to a copier that is off, so nothing ships it.
        const offFolders = manifestPath
          ? turnedOffPublicFolders(manifestPath, compiler.options.context)
          : []
        const strandedFiles =
          offFolders.length > 0
            ? findMissingFilesOnDisk(
                outputPath,
                collectFilesInTurnedOffPublic(manifest, offFolders)
              )
            : []

        if (strandedFiles.length > 0) {
          if (isCompilerRestarting(compiler)) return

          const err = new rspack.WebpackError(
            messages.manifestFilesInTurnedOffPublic(strandedFiles)
          ) as Error & {file?: string}
          err.file = 'manifest.json'
          compilation.errors.push(err)

          return
        }

        const requiredFiles = collectRequiredManifestFiles(manifest)
        const missingFiles = findMissingFilesOnDisk(outputPath, requiredFiles)

        if (missingFiles.length > 0) {
          // The entries are missing because this compiler never included
          // them; the restart already scheduled emits them, so stay quiet.
          if (isCompilerRestarting(compiler)) return

          const sample = missingFiles.slice(0, 5).join('\n  - ')
          const more =
            missingFiles.length > 5
              ? `\n  ... and ${missingFiles.length - 5} more`
              : ''
          const err = new rspack.WebpackError(
            [
              'manifest.json references files that were not emitted to disk for this build:',
              `  - ${sample}${more}`,
              '',
              'The previous manifest.json was kept to avoid loading a broken extension.',
              'Most often this is one of:',
              '  • An outdated Extension.js. Run `npm ls extension` and update to the',
              '    latest, this missing-entry class (e.g. engine-family targets like',
              '    `chromium-based`) was fixed in 4.0.0.',
              '  • A skipped chunk on an incremental rebuild. Save a source file again,',
              '    or restart after removing the `dist/` folder for a clean build.'
            ].join('\n')
          ) as Error & {file?: string}
          err.file = 'manifest.json'
          compilation.errors.push(err)

          return
        }

        const manifestOutputPath = path.join(outputPath, 'manifest.json')

        try {
          try {
            const currentOnDisk = fs.readFileSync(manifestOutputPath, 'utf-8')
            if (currentOnDisk === manifestSource) return
          } catch {
            // Ignore
          }

          writeFileAtomically(manifestOutputPath, manifestSource)
        } catch (error) {
          const err = new rspack.WebpackError(
            `Failed to persist manifest.json to disk: ${(error as Error).message}`
          ) as Error & {file?: string}
          err.file = 'manifest.json'
          compilation.errors.push(err)
        }
      }
    )
  }
}
