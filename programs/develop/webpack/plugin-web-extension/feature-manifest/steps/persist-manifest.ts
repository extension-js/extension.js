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

function compilationHasAsset(compilation: Compilation, filename: string) {
  if (typeof compilation.getAsset === 'function') {
    if (compilation.getAsset(filename)) return true
  }

  return Boolean(
    (compilation.assets as Record<string, unknown> | undefined)?.[filename]
  )
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

function isFinalManifestReadyForDisk(
  compilation: Compilation,
  manifestSource: string
) {
  const manifest = readJsonSafe(manifestSource)
  if (!manifest) return false

  const requiredFiles = collectRequiredManifestFiles(manifest)
  if (requiredFiles.length === 0) return true

  return requiredFiles.every((filename) =>
    compilationHasAsset(compilation, filename)
  )
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
    compiler.hooks.thisCompilation.tap(
      'manifest:persist-manifest',
      (compilation: Compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'manifest:persist-manifest',
            stage: Compilation.PROCESS_ASSETS_STAGE_REPORT + 1000
          },
          () => {
            if (compilation.errors.length > 0) return

            const outputPath =
              compilation.outputOptions.path || compiler.options.output?.path

            if (!outputPath) return

            const manifestAsset = compilation.getAsset('manifest.json')
            const manifestSource =
              getCurrentManifestContent(compilation) ||
              manifestAsset?.source?.source?.().toString()

            if (!manifestSource) return
            if (!isFinalManifestReadyForDisk(compilation, manifestSource))
              return

            const manifestOutputPath = path.join(outputPath, 'manifest.json')

            try {
              try {
                const currentOnDisk = fs.readFileSync(
                  manifestOutputPath,
                  'utf-8'
                )
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
    )
  }
}
