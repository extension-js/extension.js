//      ██╗███████╗ ██████╗ ███╗   ██╗
//      ██║██╔════╝██╔═══██╗████╗  ██║
//      ██║███████╗██║   ██║██╔██╗ ██║
// ██   ██║╚════██║██║   ██║██║╚██╗██║
// ╚█████╔╝███████║╚██████╔╝██║ ╚████║
//  ╚════╝ ╚══════╝ ╚═════╝ ╚═╝  ╚═══╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {type Compilation, sources, WebpackError} from '@rspack/core'
import {isDebug} from '../../lib/messaging'
import {isCriticalJsonFeature, validateJsonAsset} from './json-validation'
import * as messages from './messages'
import {resolveJsonResource} from './resolve-json-resource'

function getProjectPathFromCompilation(
  compilation: Compilation,
  manifestPath: string
): string {
  return (
    compilation.compiler.options.context ||
    compilation.options.context ||
    path.dirname(manifestPath)
  )
}

export function processJsonAssets(
  compilation: Compilation,
  manifestPath: string,
  includeList: Record<string, string | string[] | undefined>
): void {
  if (compilation.errors.length > 0) return

  const jsonFields = includeList || {}
  const manifestDir = path.dirname(manifestPath)
  const projectPath = getProjectPathFromCompilation(compilation, manifestPath)
  const publicDir = path.join(projectPath, 'public')

  if (isDebug()) {
    const featureKeys = Object.keys(jsonFields || {})
    const criticalCount = featureKeys.filter((key) =>
      isCriticalJsonFeature(key)
    ).length

    console.log(messages.jsonIncludeSummary(featureKeys.length, criticalCount))
  }

  for (const field of Object.entries(jsonFields)) {
    const [feature, resource] = field
    let emittedCount = 0
    let underPublicCount = 0
    let missingCount = 0
    let validatedOk = 0
    let invalid = 0

    const resourceArr: Array<string | undefined> = Array.isArray(resource)
      ? resource
      : [resource]

    for (const thisResource of resourceArr) {
      // Resources from the manifest lib can come as undefined.
      if (thisResource) {
        const {abs, isUnderPublic, isPublicRoot} = resolveJsonResource(
          thisResource,
          manifestDir,
          projectPath
        )

        if (!fs.existsSync(abs)) {
          // Leading '/' is the public/ output root, not the OS filesystem root.
          const outputRoot = compilation?.options?.output?.path || ''
          const displayPath = isPublicRoot
            ? path.join(outputRoot || publicDir, String(thisResource).slice(1))
            : abs
          const isFatal = isCriticalJsonFeature(feature)
          const notFound = new WebpackError(
            messages.jsonMissingFile(feature, displayPath, {
              publicRootHint: isPublicRoot,
              fatal: isFatal
            })
          )
          notFound.name = 'JSONMissingFile'
          // Show manifest context in header
          // @ts-expect-error file is not typed
          notFound.file = 'manifest.json'
          if (isFatal) {
            compilation.errors.push(notFound)
          } else {
            compilation.warnings.push(notFound)
          }
          missingCount++
          continue
        }

        // Under public: do not emit; track for watch and (for critical) validate JSON
        if (isUnderPublic) {
          try {
            compilation.fileDependencies.add(abs)
          } catch {
            // Ignore
          }
          if (isCriticalJsonFeature(feature)) {
            const ok = validateJsonAsset(
              compilation,
              feature,
              abs,
              fs.readFileSync(abs)
            )
            if (ok) validatedOk++
            else invalid++
            if (!ok) continue
          }
          underPublicCount++
          continue
        }

        const source = fs.readFileSync(abs)

        if (isCriticalJsonFeature(feature)) {
          const ok = validateJsonAsset(compilation, feature, abs, source)
          if (ok) validatedOk++
          else invalid++
          if (!ok) continue
        }
        const rawSource = new sources.RawSource(source)
        const assetName = `${feature}.json`

        // If asset already exists (e.g., when handling arrays), update it instead of emitting again
        if (
          typeof compilation.getAsset === 'function' &&
          compilation.getAsset(assetName)
        ) {
          compilation.updateAsset(assetName, rawSource)
        } else {
          compilation.emitAsset(assetName, rawSource)
        }
        emittedCount++
      }
    }

    if (isDebug()) {
      const entries = Array.isArray(resource)
        ? resource.length
        : resource
          ? 1
          : 0

      console.log(
        messages.jsonEmitSummary(feature, {
          entries,
          underPublic: underPublicCount,
          emitted: emittedCount,
          missing: missingCount,
          validatedOk,
          invalid
        })
      )
    }
  }
}
