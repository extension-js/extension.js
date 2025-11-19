import * as path from 'path'
import * as fs from 'fs'
import {Compiler, sources, Compilation} from '@rspack/core'
import * as messages from './messages'
import {getLocales} from './get-locales'
import {type FilepathList, type PluginInterface} from '../../webpack-types'

function pushCompilationError(
  compiler: Compiler,
  compilation: Compilation,
  name: string,
  message: string,
  file?: string
) {
  const ErrorConstructor = (compiler as any)?.rspack?.WebpackError || Error
  const error = new ErrorConstructor(message) as Error & {file?: string}
  error.name = name
  if (file) error.file = file

  if (!compilation.errors) {
    compilation.errors = []
  }
  compilation.errors.push(error)
}

/**
 * LocalesPlugin is responsible for emitting the locales files
 * to the output directory.
 */
export class LocalesPlugin {
  public readonly manifestPath: string
  public readonly includeList?: FilepathList

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList
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
          // Do not emit if manifest doesn't exist.
          if (!fs.existsSync(this.manifestPath)) {
            const ErrorConstructor = compiler?.rspack?.WebpackError || Error
            const error = new ErrorConstructor(
              messages.manifestNotFoundMessageOnly(this.manifestPath)
            )

            error.name = 'ManifestNotFoundError'
            // @ts-expect-error - file is not a property of Error
            error.file = String(this.manifestPath)

            if (!compilation.errors) {
              compilation.errors = []
            }

            compilation.errors.push(error)
            return
          }

          // Validate locales/default_locale consistency across browsers
          try {
            const manifestDir = path.dirname(this.manifestPath)
            const manifestRaw = fs.readFileSync(this.manifestPath, 'utf8')
            const manifest = JSON.parse(manifestRaw) as Record<string, any>
            const defaultLocale = manifest?.default_locale

            const localesRoot = path.join(manifestDir, '_locales')
            const hasLocalesRoot = fs.existsSync(localesRoot)

            if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
              console.log(
                messages.localesIncludeSummary(
                  true,
                  hasLocalesRoot,
                  typeof defaultLocale === 'string' ? defaultLocale : undefined
                )
              )
            }

            if (typeof defaultLocale === 'string' && defaultLocale.trim()) {
              if (!hasLocalesRoot) {
                if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
                  console.log(
                    messages.localesValidationDetected(
                      'default_locale set but _locales missing'
                    )
                  )
                }
                pushCompilationError(
                  compiler,
                  compilation,
                  'LocalesValidationError',
                  messages.defaultLocaleSpecifiedButLocalesMissing(),
                  'manifest.json'
                )
                return
              }

              const defaultLocaleDir = path.join(localesRoot, defaultLocale)
              if (!fs.existsSync(defaultLocaleDir)) {
                if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
                  console.log(
                    messages.localesValidationDetected(
                      `missing _locales/${defaultLocale}`
                    )
                  )
                }

                pushCompilationError(
                  compiler,
                  compilation,
                  'LocalesValidationError',
                  messages.defaultLocaleFolderMissing(defaultLocale),
                  'manifest.json'
                )
                return
              }

              const messagesJsonPath = path.join(
                defaultLocaleDir,
                'messages.json'
              )

              if (!fs.existsSync(messagesJsonPath)) {
                if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
                  console.log(
                    messages.localesValidationDetected(
                      `missing _locales/${defaultLocale}/messages.json`
                    )
                  )
                }

                pushCompilationError(
                  compiler,
                  compilation,
                  'LocalesValidationError',
                  messages.defaultLocaleMessagesMissing(defaultLocale),
                  'manifest.json'
                )
                return
              }

              // Validate JSON of default locale messages
              try {
                const content = fs.readFileSync(messagesJsonPath, 'utf8')
                JSON.parse(content)
              } catch (e) {
                if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
                  console.log(
                    messages.localesValidationDetected(
                      `invalid JSON in _locales/${defaultLocale}/messages.json`
                    )
                  )
                }

                pushCompilationError(
                  compiler,
                  compilation,
                  'LocalesValidationError',
                  messages.invalidMessagesJson(messagesJsonPath),
                  'manifest.json'
                )
                return
              }

              // Ensure all __MSG_*__ placeholders referenced in manifest exist in default locale
              try {
                const content = fs.readFileSync(messagesJsonPath, 'utf8')
                const dict = JSON.parse(content)

                const collectMsgKeys = (value: unknown, acc: Set<string>) => {
                  if (typeof value === 'string') {
                    // Allow placeholders anywhere a string is used
                    const regex = /__MSG_([a-zA-Z0-9_]+)__/g
                    let matches: RegExpExecArray | null

                    while ((matches = regex.exec(value)) !== null) {
                      const key = matches[1]
                      if (key) acc.add(key)
                    }
                  } else if (Array.isArray(value)) {
                    for (const item of value) {
                      collectMsgKeys(item, acc)
                    }
                  } else if (value && typeof value === 'object') {
                    for (const v of Object.values(
                      value as Record<string, any>
                    )) {
                      collectMsgKeys(v, acc)
                    }
                  }
                }

                const referenced = new Set<string>()
                collectMsgKeys(manifest, referenced)

                for (const key of referenced) {
                  const entry = dict?.[key]

                  if (!entry || typeof entry.message !== 'string') {
                    if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
                      console.log(
                        messages.localesValidationDetected(
                          `missing key "${key}" in default locale`
                        )
                      )
                    }

                    pushCompilationError(
                      compiler,
                      compilation,
                      'LocalesValidationError',
                      messages.missingManifestMessageKey(key, defaultLocale),
                      'manifest.json'
                    )
                    return
                  }
                }
              } catch {
                // If scanning fails, do not crash; other validators handle JSON structure
              }
            } else if (hasLocalesRoot) {
              // _locales present but no default_locale in manifest: browsers reject the extension
              if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
                console.log(
                  messages.localesValidationDetected(
                    '_locales present but no default_locale'
                  )
                )
              }

              pushCompilationError(
                compiler,
                compilation,
                'LocalesValidationError',
                messages.localesPresentButNoDefaultLocale(),
                'manifest.json'
              )
              return
            }
          } catch {
            // If manifest cannot be parsed, defer to manifest feature/other validators
          }

          if (compilation.errors.length > 0) return

          // Validate all locale JSON files are syntactically valid
          try {
            const manifestDir = path.dirname(this.manifestPath)
            const localesRoot = path.join(manifestDir, '_locales')
            if (fs.existsSync(localesRoot)) {
              const localeDirs = fs
                .readdirSync(localesRoot)
                .map((d) => path.join(localesRoot, d))
                .filter((p) => fs.statSync(p).isDirectory())

              for (const localeDir of localeDirs) {
                const msgPath = path.join(localeDir, 'messages.json')
                if (fs.existsSync(msgPath)) {
                  try {
                    const s = fs.readFileSync(msgPath, 'utf8')
                    JSON.parse(s)
                  } catch {
                    if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
                      console.log(
                        messages.localesValidationDetected(
                          `invalid JSON in ${msgPath}`
                        )
                      )
                    }

                    pushCompilationError(
                      compiler,
                      compilation,
                      'LocalesValidationError',
                      messages.invalidMessagesJson(msgPath),
                      'manifest.json'
                    )
                    return
                  }
                }
              }
            }
          } catch {
            // ignore
          }

          const localesFields = getLocales(this.manifestPath)
          const discoveredList = getLocales(this.manifestPath) || []
          let emittedCount = 0
          let missingCount = 0

          for (const field of Object.entries(localesFields || [])) {
            const [feature, resource] = field
            const thisResource = resource

            // Resources from the manifest lib can come as undefined.
            if (thisResource) {
              // Only process .json files
              if (path.extname(thisResource) !== '.json') {
                continue
              }

              if (!fs.existsSync(thisResource)) {
                const ErrorConstructor = compiler?.rspack?.WebpackError || Error
                const warning = new ErrorConstructor(
                  messages.entryNotFoundMessageOnly(feature)
                )

                // @ts-expect-error - file is not a property of Error
                warning.file = thisResource
                ;(warning as any).name = 'LocalesPluginMissingFile'

                if (!compilation.warnings) {
                  compilation.warnings = []
                }

                compilation.warnings.push(warning)
                missingCount++
                continue
              }

              const source = fs.readFileSync(thisResource)
              const rawSource = new sources.RawSource(source)
              // Always emit locales at the bundle root: `_locales/...`
              // regardless of where the manifest lives (e.g., src/manifest.json)
              const manifestDir = path.dirname(this.manifestPath)
              const localesRoot = path.join(manifestDir, '_locales')
              const relativeToLocales = path.relative(localesRoot, thisResource)

              // Normalize to POSIX-style for asset keys
              const normalizedRel = relativeToLocales.split(path.sep).join('/')
              const filename = `_locales/${normalizedRel}`

              compilation.emitAsset(filename, rawSource)
              emittedCount++
            }
          }

          if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
            console.log(
              messages.localesEmitSummary(
                emittedCount,
                missingCount,
                discoveredList.length
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
          let added = 0

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
                    added++
                  }
                }
              }
            }
          }
          if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
            console.log(messages.localesDepsTracked(added))
          }
        }
      )
    })
  }
}
