// ██╗ ██████╗ ██████╗ ███╗   ██╗███████╗
// ██║██╔════╝██╔═══██╗████╗  ██║██╔════╝
// ██║██║     ██║   ██║██╔██╗ ██║███████╗
// ██║██║     ██║   ██║██║╚██╗██║╚════██║
// ██║╚██████╗╚██████╔╝██║ ╚████║███████║
// ╚═╝ ╚═════╝ ╚═════╝ ╚═╝  ╚═══╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {Compilation, type Compiler, sources} from '@rspack/core'
import {isDebug} from '../../../lib/messaging'
import type {FilepathList, PluginInterface} from '../../../types'
import {
  iconOutputPath,
  themeIconOutputPath
} from '../../feature-manifest/normalize-manifest-path'
import {reportToCompilation} from '../../shared/compilation-issues'
import * as messages from '../messages'
import {iconValuesToStrings} from '../normalize-keys'

// statSync is absent under the fs mocks some specs install, so treat an
// unreadable stat as "not empty" and let the emit proceed.
function isEmptyFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).size === 0
  } catch {
    return false
  }
}

export class EmitFile {
  public readonly manifestPath: string
  public readonly includeList?: FilepathList

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList
  }

  public apply(compiler: Compiler): void {
    compiler.hooks.thisCompilation.tap('icons:emit-file', (compilation) => {
      compilation.hooks.processAssets.tap(
        {
          name: 'icons:emit-file',
          stage: Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_TRANSFER
        },
        () => {
          if (compilation.errors.length > 0) return

          const iconFields = this.includeList || {}
          const manifestDir = path.dirname(this.manifestPath)
          const projectPath =
            (compiler.options.context as string) || manifestDir
          const publicDir = path.join(projectPath, 'public')

          for (const field of Object.entries(iconFields)) {
            const [feature, resource] = field

            if (resource === undefined) continue

            const stringEntries = iconValuesToStrings(resource)
            let emittedCount = 0
            let underPublicCount = 0
            let missingCount = 0
            const entriesTotal = stringEntries.length

            for (const entry of stringEntries) {
              // Resources from the manifest lib can come as undefined.
              if (entry) {
                // Normalize manifest paths: leading '/' means extension root (public/); relative
                // resolves from the manifest dir; absolute OS paths are used as-is.
                const manifestDir = path.dirname(this.manifestPath)

                let resolved = entry

                if (!fs.existsSync(resolved)) {
                  if (path.isAbsolute(entry) && entry.startsWith(projectPath)) {
                    // OS-absolute path under the project root: prefer public/<basename> when it
                    // exists there, otherwise keep the absolute path.
                    const basename = path.basename(entry)
                    const publicCandidate = path.join(publicDir, basename)

                    if (process.env.EXTENSION_DEV_DEBUG_ICONS === '1') {
                      // eslint-disable-next-line no-console
                      console.log(
                        '[icons:emit-file] absolute entry',
                        JSON.stringify({
                          entry,
                          projectPath,
                          publicDir,
                          basename,
                          publicCandidate,
                          exists: fs.existsSync(publicCandidate)
                        })
                      )
                    }

                    resolved = fs.existsSync(publicCandidate)
                      ? publicCandidate
                      : entry
                  } else if (entry.startsWith('/')) {
                    // First, look under public/ because "/foo.png" is authored
                    // as an extension-root asset served from public/.
                    const publicCandidate = path.join(
                      projectPath,
                      'public',
                      entry.slice(1)
                    )

                    if (process.env.EXTENSION_DEV_DEBUG_ICONS === '1') {
                      // eslint-disable-next-line no-console
                      console.log(
                        '[icons:emit-file] leading-slash entry',
                        JSON.stringify({
                          entry,
                          projectPath,
                          publicCandidate,
                          exists: fs.existsSync(publicCandidate)
                        })
                      )
                    }

                    resolved = fs.existsSync(publicCandidate)
                      ? publicCandidate
                      : path.join(projectPath, entry.slice(1))
                  } else {
                    // Bare/relative icon paths also respect the public/ convention before falling
                    // back to the manifest directory, consistent with web_accessible_resources.
                    const publicCandidate = path.join(publicDir, entry)

                    if (process.env.EXTENSION_DEV_DEBUG_ICONS === '1') {
                      // eslint-disable-next-line no-console
                      console.log(
                        '[icons:emit-file] relative entry',
                        JSON.stringify({
                          entry,
                          projectPath,
                          publicDir,
                          publicCandidate,
                          exists: fs.existsSync(publicCandidate),
                          manifestDir
                        })
                      )
                    }

                    if (fs.existsSync(publicCandidate)) {
                      resolved = publicCandidate
                    } else {
                      resolved = path.isAbsolute(entry)
                        ? entry
                        : path.join(manifestDir, entry)
                    }
                  }
                }

                // Robust containment check using path.relative to handle Windows cases
                const relToPublic = path.relative(publicDir, resolved)

                const isUnderPublic =
                  (relToPublic &&
                    !relToPublic.startsWith('..') &&
                    !path.isAbsolute(relToPublic)) ||
                  (entry.startsWith('/') &&
                    fs.existsSync(
                      path.join(projectPath, 'public', entry.slice(1))
                    ))

                const parts = String(feature).split('/')
                const group = parts[0]
                const sub = parts[1] || ''
                const isDefaultIconFamily =
                  (group === 'action' ||
                    group === 'browser_action' ||
                    group === 'page_action' ||
                    group === 'sidebar_action' ||
                    group === 'omnibox') &&
                  sub === 'default_icon'
                // Chrome refuses the WHOLE extension over a theme image it cannot
                // find ("Could not load 'theme/images/x.png' for theme"), and
                // --load-extension shows that only as a native modal.
                const isThemeImage = group === 'theme' && sub === 'images'

                if (!fs.existsSync(resolved)) {
                  // Leading '/' (extension-root style) maps to the output/public root;
                  // OS-absolute paths are handled separately above and skip the hint.
                  const isPublicRoot =
                    entry.startsWith('/') && !entry.startsWith(projectPath)

                  // Display path consistent with HTML/web-resources features: public-root style
                  // shows <project>/public/<entry>; OS-absolute as-is; else relative to project root.
                  const displayPath =
                    !path.isAbsolute(entry) && isPublicRoot
                      ? path.join(projectPath, 'public', entry.slice(1))
                      : path.isAbsolute(entry)
                        ? entry
                        : path.join(projectPath, entry)
                  const isFatal =
                    group === 'icons' || isDefaultIconFamily || isThemeImage
                  const severity: 'error' | 'warning' = isFatal
                    ? 'error'
                    : 'warning'

                  reportToCompilation(
                    compilation,
                    compiler,
                    isThemeImage
                      ? messages.themeImageMissingFile(feature, displayPath, {
                          publicRootHint: isPublicRoot
                        })
                      : messages.iconsMissingFile(feature, displayPath, {
                          publicRootHint: isPublicRoot,
                          fatal: isFatal
                        }),
                    severity,
                    'manifest.json'
                  )
                  missingCount++
                  continue
                }

                // A 0-byte theme image still loads the extension, but Chrome drops
                // the ENTIRE theme over it, so the build must not stay silent.
                if (isThemeImage && isEmptyFile(resolved)) {
                  reportToCompilation(
                    compilation,
                    compiler,
                    messages.themeImageIsEmpty(feature, resolved),
                    'warning',
                    'manifest.json'
                  )
                }

                // Under public: do not emit; track for watch
                if (isUnderPublic) {
                  try {
                    compilation.fileDependencies.add(resolved)
                  } catch {
                    // Ignore
                  }

                  underPublicCount++
                  continue
                }

                const source = fs.readFileSync(resolved)
                const rawSource = new sources.RawSource(source)

                const basename = path.basename(resolved)

                const isThemeIcons =
                  (group === 'browser_action' || group === 'action') &&
                  sub === 'theme_icons'

                let outputDir = group
                if (isDefaultIconFamily) {
                  outputDir = 'icons'
                } else if (isThemeIcons) {
                  // MV2 browser_action and Firefox MV3 action theme_icons both
                  // land under their manifest key folder.
                  outputDir = group
                } else if (isThemeImage) {
                  // Theme image keys arrive as theme/images/<basename>, so the file must land
                  // there to match the path the theme manifest override writes.
                  outputDir = 'theme/images'
                }

                let filename = `${outputDir}/${basename}`
                const relFromManifest = path
                  .relative(manifestDir, resolved)
                  .replace(/\\/g, '/')

                // Lockstep with the manifest overrides: in-project icons keep
                // their location, outside-root icons get a unique slot, and
                // both sides compute it from the same helper.
                if (outputDir === 'icons') {
                  if (relFromManifest && !path.isAbsolute(relFromManifest)) {
                    filename = iconOutputPath(relFromManifest)
                  } else if (resolved) {
                    filename = iconOutputPath(resolved)
                  }
                }

                if (isThemeIcons) {
                  const folder =
                    group === 'action' ? 'action' : 'browser_action'
                  if (relFromManifest && !path.isAbsolute(relFromManifest)) {
                    filename = themeIconOutputPath(relFromManifest, folder)
                  } else if (resolved) {
                    filename = themeIconOutputPath(resolved, folder)
                  }
                }

                compilation.emitAsset(filename, rawSource)
                emittedCount++
              }
            }

            if (isDebug()) {
              console.log(
                messages.iconsEmitSummary(feature, {
                  entries: entriesTotal,
                  underPublic: underPublicCount,
                  emitted: emittedCount,
                  missing: missingCount
                })
              )
            }
          }
        }
      )
    })
  }
}
