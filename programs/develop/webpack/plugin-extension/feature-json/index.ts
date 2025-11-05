import * as fs from 'fs'
import * as path from 'path'
import {Compiler, sources, Compilation, WebpackError} from '@rspack/core'
import * as messages from './messages'
import {ThrowIfManifestJsonChange} from './steps/throw-if-manifest-json-change'
import {type FilepathList, type PluginInterface} from '../../webpack-types'
import {DevOptions} from '../../types/options'

/**
 * JsonPlugin is responsible for handling the JSON files defined
 * in the manifest.json. It emits the JSON files to the output
 * directory and adds them to the file dependencies of the compilation.
 *
 * Features supported:
 * - declarative_net_request.ruleset
 * - storage.managed_schema
 */
export class JsonPlugin {
  public readonly manifestPath: string
  public readonly includeList?: FilepathList
  public readonly browser?: DevOptions['browser'] | 'chrome'

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList
    this.browser = options.browser
  }

  private isCriticalJsonFeature(feature: string) {
    return (
      feature.startsWith('declarative_net_request') ||
      feature === 'storage.managed_schema'
    )
  }

  private validateJsonAsset(
    compilation: Compilation,
    feature: string,
    filePath: string,
    buf: Buffer
  ) {
    let parsed: unknown
    try {
      parsed = JSON.parse(buf.toString('utf-8'))
    } catch (e: any) {
      const err = new WebpackError(
        messages.invalidJsonSyntax(feature, filePath, String(e?.message || e))
      )
      ;(err as any).file = filePath
      err.name = 'JSONInvalidSyntax'
      compilation.errors.push(err)
      return false
    }

    if (feature.startsWith('declarative_net_request')) {
      if (!Array.isArray(parsed)) {
        const err = new WebpackError(
          messages.invalidRulesetStructure(feature, filePath)
        )
        ;(err as any).file = filePath
        err.name = 'DNRInvalidRuleset'
        compilation.errors.push(err)
        return false
      }
    } else if (feature === 'storage.managed_schema') {
      if (
        parsed === null ||
        Array.isArray(parsed) ||
        typeof parsed !== 'object'
      ) {
        const err = new WebpackError(
          messages.invalidManagedSchemaStructure(feature, filePath)
        )
        ;(err as any).file = filePath
        err.name = 'ManagedSchemaInvalid'
        compilation.errors.push(err)
        return false
      }
    }

    return true
  }

  public apply(compiler: Compiler): void {
    // Restart-required if critical manifest JSON entries changed.
    new ThrowIfManifestJsonChange({
      manifestPath: this.manifestPath,
      includeList: this.includeList,
      browser: this.browser || 'chrome'
    }).apply(compiler)

    // Add the JSON to the compilation. This is important so other
    // plugins can get it via the compilation.assets object,
    // allowing them to modify it.
    compiler.hooks.thisCompilation.tap('json:module', (compilation) => {
      compilation.hooks.processAssets.tap(
        {
          name: 'json:module',
          // Add additional assets to the compilation.
          stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONS
        },
        () => {
          if (compilation.errors.length > 0) return

          const jsonFields = this.includeList || {}
          const manifestDir = path.dirname(this.manifestPath)
          const projectPath = compiler.options.context as string
          const publicDir = path.join(projectPath, 'public' + path.sep)

          for (const field of Object.entries(jsonFields)) {
            const [feature, resource] = field

            const resourceArr: Array<string | undefined> = Array.isArray(
              resource
            )
              ? resource
              : [resource]

            for (const thisResource of resourceArr) {
              // Resources from the manifest lib can come as undefined.
              if (thisResource) {
                const abs = path.isAbsolute(thisResource)
                  ? thisResource
                  : path.join(manifestDir, thisResource)
                const isUnderPublic = String(abs).startsWith(publicDir)

                // Missing file handling
                if (!fs.existsSync(abs)) {
                  // Determine if the original authoring used an extension-root path ('/').
                  // includeList values may be absolute or relative; prefer the raw provided value.
                  const rawRef = String(thisResource)
                  const isPublicRoot =
                    rawRef.startsWith('/') && !path.isAbsolute(rawRef)
                  const outputRoot = compilation?.options?.output?.path || ''
                  const displayPath = isPublicRoot
                    ? path.join(outputRoot, rawRef.slice(1))
                    : abs
                  const notFound = new WebpackError(
                    messages.jsonMissingFile(feature, displayPath, {
                      publicRootHint: isPublicRoot
                    })
                  )
                  notFound.name = 'JSONMissingFile'
                  // Show manifest context in header
                  // @ts-expect-error file is not typed
                  notFound.file = 'manifest.json'
                  if (this.isCriticalJsonFeature(feature)) {
                    compilation.errors.push(notFound)
                  } else {
                    compilation.warnings.push(notFound)
                  }
                  continue
                }

                // Under public: do not emit; track for watch and (for critical) validate JSON
                if (isUnderPublic) {
                  try {
                    compilation.fileDependencies.add(abs)
                  } catch {}
                  if (this.isCriticalJsonFeature(feature)) {
                    const ok = this.validateJsonAsset(
                      compilation,
                      feature,
                      abs,
                      fs.readFileSync(abs)
                    )
                    if (!ok) continue
                  }
                  continue
                }

                const source = fs.readFileSync(abs)

                if (this.isCriticalJsonFeature(feature)) {
                  const ok = this.validateJsonAsset(
                    compilation,
                    feature,
                    abs,
                    source
                  )
                  if (!ok) continue
                }
                const rawSource = new sources.RawSource(source)
                const assetName = feature + '.json'

                // If asset already exists (e.g., when handling arrays), update it instead of emitting again
                if (
                  typeof (compilation as any).getAsset === 'function' &&
                  (compilation as any).getAsset(assetName)
                ) {
                  ;(compilation as any).updateAsset(assetName, rawSource)
                } else {
                  compilation.emitAsset(assetName, rawSource)
                }
              }
            }
          }
        }
      )
    })

    // Ensure this JSON file and its assets are stored as file
    // dependencies so webpack can watch and trigger changes.
    compiler.hooks.thisCompilation.tap('json:module', (compilation) => {
      compilation.hooks.processAssets.tap(
        {
          name: 'json:module',
          stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONS
        },
        () => {
          if (compilation.errors?.length) return

          const jsonFields = this.includeList || {}
          const manifestDir = path.dirname(this.manifestPath)

          for (const field of Object.entries(jsonFields)) {
            const [, resource] = field

            const resourceArr: Array<string | undefined> = Array.isArray(
              resource
            )
              ? resource
              : [resource]

            for (const thisResource of resourceArr) {
              if (thisResource) {
                const abs = path.isAbsolute(thisResource)
                  ? thisResource
                  : path.join(manifestDir, thisResource)
                const fileDependencies = new Set(compilation.fileDependencies)
                if (fs.existsSync(abs)) {
                  if (!fileDependencies.has(abs)) {
                    fileDependencies.add(abs)
                    compilation.fileDependencies.add(abs)
                  }
                }
              }
            }
          }
        }
      )
    })
  }
}
