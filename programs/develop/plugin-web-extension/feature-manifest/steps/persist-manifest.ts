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
import {getCurrentManifestContent} from '../manifest-lib/manifest'

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
  if (/^(https?:)?\/\//i.test(filePath)) return undefined
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
  apply(compiler: Compiler) {
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

        const requiredFiles = collectRequiredManifestFiles(manifest)
        const missingFiles = findMissingFilesOnDisk(outputPath, requiredFiles)

        if (missingFiles.length > 0) {
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
