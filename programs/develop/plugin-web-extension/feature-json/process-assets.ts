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
import {debugLine, isDebug} from '../../lib/messaging'
import {sourceFileMayShip} from '../../plugin-special-folders/public-private-files'
import {isFolder} from '../shared/paths'
import {isCriticalJsonFeature, validateJsonAsset} from './json-validation'
import * as messages from './messages'
import {
  jsonFieldClimbsOutOfRoot,
  resolveJsonResource
} from './resolve-json-resource'

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
  includeList: Record<string, string | undefined>,
  browser?: string
): void {
  // A compile that already failed still names the JSON files the manifest
  // cannot find, so one run reports every fix needed.
  const reportOnly = compilation.errors.length > 0

  if (reportOnly && !compilation.getAsset('manifest.json')) return

  const jsonFields = includeList || {}
  const manifestDir = path.dirname(manifestPath)
  const projectPath = getProjectPathFromCompilation(compilation, manifestPath)

  if (isDebug()) {
    const featureKeys = Object.keys(jsonFields || {})
    const criticalCount = featureKeys.filter((key) =>
      isCriticalJsonFeature(key)
    ).length

    debugLine(messages.jsonIncludeSummary(featureKeys.length, criticalCount))
  }

  for (const field of Object.entries(jsonFields)) {
    const [feature, resource] = field
    const climbsOut = jsonFieldClimbsOutOfRoot(
      compilation,
      manifestPath,
      feature
    )
    let emittedCount = 0
    let underPublicCount = 0
    let missingCount = 0
    let validatedOk = 0
    let invalid = 0

    // One file per key. Kept as a loop so every early exit below still
    // reaches the summary line at the end of this key.
    for (const thisResource of [resource]) {
      // Resources from the manifest lib can come as undefined.
      if (thisResource) {
        const {abs, isUnderPublic, isPublicRoot} = resolveJsonResource(
          thisResource,
          manifestDir,
          projectPath
        )

        // A file the build withholds is never opened, so no message can
        // quote it. It gets the finding a missing file gets.
        if (climbsOut || !sourceFileMayShip(abs, [projectPath, manifestDir])) {
          const displayPath = abs
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

        if (isFolder(abs)) {
          const isFatal = isCriticalJsonFeature(feature)
          const folder = new WebpackError(
            messages.jsonPathIsFolder(feature, abs, {fatal: isFatal})
          )
          folder.name = 'JSONPathIsFolder'
          // @ts-expect-error file is not typed
          folder.file = 'manifest.json'

          if (isFatal) {
            compilation.errors.push(folder)
          } else {
            compilation.warnings.push(folder)
          }

          missingCount++
          continue
        }

        if (reportOnly) continue

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
              fs.readFileSync(abs),
              browser
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
          const ok = validateJsonAsset(
            compilation,
            feature,
            abs,
            source,
            browser
          )
          if (ok) validatedOk++
          else invalid++
          if (!ok) continue
        }

        const rawSource = new sources.RawSource(source)
        const assetName = `${feature}.json`

        // Another plugin may have emitted this name: replace, never emit twice.
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
      const entries = resource ? 1 : 0

      debugLine(
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
