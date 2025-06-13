import * as path from 'path'
import * as fs from 'fs'
import rspack, {Compiler, sources, Compilation} from '@rspack/core'
import {type FilepathList, type PluginInterface} from '../../webpack-types'
import * as messages from '../../lib/messages'
import * as utils from '../../lib/utils'
import {getLocales} from './get-locales'

/**
 * LocalesPlugin is responsible for emitting the locales files
 * to the output directory.
 */
export class LocalesPlugin {
  public readonly manifestPath: string
  public readonly includeList?: FilepathList
  public readonly excludeList?: FilepathList

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList
    this.excludeList = options.excludeList
  }

  public apply(compiler: Compiler): void {
    // Add the locales to the compilation. This is important so other
    // plugins can get it via the compilation.assets object,
    // allowing them to modify it.
    compiler.hooks.thisCompilation.tap('locales:module', (compilation) => {
      compilation.hooks.processAssets.tap(
        {
          name: 'locales:module',
          // Add additional assets to the compilation.
          stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONS
        },
        () => {
          console.log('Processing assets...')
          console.log('Manifest path:', this.manifestPath)
          console.log('Manifest exists:', fs.existsSync(this.manifestPath))

          // Do not emit if manifest doesn't exist.
          if (!fs.existsSync(this.manifestPath)) {
            compilation.errors.push(
              new rspack.WebpackError(
                messages.manifestNotFoundError(
                  'Extension.js',
                  this.manifestPath
                )
              )
            )
            return
          }

          try {
            const manifest = JSON.parse(
              fs.readFileSync(this.manifestPath, 'utf8')
            )
            const patchedManifest = utils.filterKeysForThisBrowser(
              manifest,
              'chrome'
            )

            const manifestName = patchedManifest.name || 'Extension.js'

            if (compilation.errors.length > 0) return

            const localesFields = getLocales(this.manifestPath)
            console.log('Locales fields:', localesFields)

            if (localesFields) {
              for (const localeFile of localesFields) {
                console.log('Processing locale file:', localeFile)
                console.log('File exists:', fs.existsSync(localeFile))
                console.log('File extension:', path.extname(localeFile))

                // Only process .json files
                if (path.extname(localeFile) !== '.json') {
                  console.log('Skipping non-JSON file')
                  continue
                }

                if (!fs.existsSync(localeFile)) {
                  console.log('File does not exist, adding warning')
                  compilation.warnings.push(
                    new rspack.WebpackError(
                      messages.entryNotFoundWarn('locale', localeFile)
                    )
                  )
                  continue
                }

                const source = fs.readFileSync(localeFile)
                const rawSource = new sources.RawSource(source)
                const context =
                  compiler.options.context || path.dirname(this.manifestPath)
                console.log('Context:', context)

                if (!utils.shouldExclude(localeFile, this.excludeList)) {
                  const filename = path.relative(context, localeFile)
                  console.log('Emitting asset:', filename)
                  compilation.emitAsset(filename, rawSource)
                  compilation.fileDependencies.add(localeFile)
                } else {
                  console.log('File excluded')
                }
              }
            } else {
              console.log('No locale fields found')
            }
          } catch (error) {
            console.error('Error processing manifest:', error)
            compilation.errors.push(
              new rspack.WebpackError(
                messages.manifestNotFoundError(
                  'Extension.js',
                  this.manifestPath
                )
              )
            )
          }
        }
      )
    })

    // Ensure this locales file and its assets are stored as file
    // dependencies so webpack can watch and trigger changes.
    compiler.hooks.thisCompilation.tap('locales:module', (compilation) => {
      compilation.hooks.processAssets.tap(
        {
          name: 'locales:module',
          stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONS
        },
        () => {
          if (compilation.errors?.length) return

          const localesFields = getLocales(this.manifestPath)

          for (const field of Object.entries(localesFields || [])) {
            const [, resource] = field

            if (resource) {
              const fileDependencies = new Set(compilation.fileDependencies)

              const fileResources = localesFields || []

              for (const thisResource of fileResources) {
                // Only add JSON files to the dependencies
                if (
                  fs.existsSync(thisResource) &&
                  path.extname(thisResource) === '.json'
                ) {
                  if (!fileDependencies.has(thisResource)) {
                    fileDependencies.add(thisResource)
                    compilation.fileDependencies.add(thisResource)
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
