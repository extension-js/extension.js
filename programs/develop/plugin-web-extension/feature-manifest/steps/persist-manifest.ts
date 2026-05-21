// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import * as fs from 'fs'
import * as path from 'path'
import rspack, {Compilation, Compiler} from '@rspack/core'
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

function collectRequiredManifestFiles(manifest: any): string[] {
  const required = new Set<string>()

  const addFile = (filePath: unknown) => {
    const normalized = normalizeManifestFile(filePath)
    if (normalized) required.add(normalized)
  }

  addFile(manifest?.background?.service_worker)
  addFile(manifest?.background?.page)

  if (Array.isArray(manifest?.background?.scripts)) {
    for (const script of manifest.background.scripts) addFile(script)
  }

  addFile(manifest?.side_panel?.default_path)

  if (Array.isArray(manifest?.content_scripts)) {
    for (const contentScript of manifest.content_scripts) {
      if (Array.isArray(contentScript?.js)) {
        for (const jsFile of contentScript.js) addFile(jsFile)
      }
      if (Array.isArray(contentScript?.css)) {
        for (const cssFile of contentScript.css) addFile(cssFile)
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
  fs.writeFileSync(tempPath, content, 'utf-8')
  fs.renameSync(tempPath, targetPath)
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
              'This usually means the bundler skipped a chunk during an incremental rebuild.',
              'Try saving any source file again, or restart `extension dev` if it persists.'
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
            // File may not exist yet; continue to write it.
          }
          writeFileAtomically(manifestOutputPath, manifestSource)
        } catch (error: any) {
          const err = new rspack.WebpackError(
            `Failed to persist manifest.json to disk: ${error.message}`
          ) as Error & {file?: string}
          err.file = 'manifest.json'
          compilation.errors.push(err)
        }
      }
    )
  }
}
