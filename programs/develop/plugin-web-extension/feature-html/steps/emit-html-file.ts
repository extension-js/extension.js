// ██╗  ██╗████████╗███╗   ███╗██╗
// ██║  ██║╚══██╔══╝████╗ ████║██║
// ███████║   ██║   ██╔████╔██║██║
// ██╔══██║   ██║   ██║╚██╔╝██║██║
// ██║  ██║   ██║   ██║ ╚═╝ ██║███████╗
// ╚═╝  ╚═╝   ╚═╝   ╚═╝     ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {Compilation, type Compiler, sources} from '@rspack/core'
import {readManifest} from '../../../lib/manifest/source-manifest'
import {filterKeysForThisBrowser} from '../../../lib/manifest-utils'
import {sourceFileMayShip} from '../../../lib/public-private-files'
import {findPublicFile} from '../../../lib/special-folders/resolve-public-folder'
import type {FilepathList, PluginInterface} from '../../../types'
import {withheldEntryKind} from '../../feature-scripts/scripts-lib/utils'
import {reportToCompilation} from '../../shared/compilation-issues'
import {markPageReportedMissing} from '../../shared/reported-missing-pages'
import * as messages from '../html-lib/messages'
import {readHtml} from '../html-lib/read-html'
import {getFilePath} from '../html-lib/utils'

export class EmitHtmlFile {
  public readonly manifestPath: string
  public readonly includeList?: FilepathList
  public readonly browser?: PluginInterface['browser']

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList
    this.browser = options.browser
  }

  public apply(compiler: Compiler): void {
    compiler.hooks.thisCompilation.tap('html:emit-html-file', (compilation) => {
      const runner = () => {
        const htmlFields = Object.entries(this.includeList || {})

        for (const field of htmlFields) {
          const [featureName, resource] = field

          if (resource) {
            if (typeof resource !== 'string') continue

            // Normalize HTML resource paths: leading '/' means extension root, relative
            // resolves from the manifest dir, absolute OS paths are used as-is.
            const projectDir = path.dirname(this.manifestPath)
            const resolved = path.isAbsolute(resource)
              ? resource
              : resource.startsWith('/')
                ? path.join(projectDir, resource.slice(1))
                : path.join(projectDir, resource)

            // A file the build never copies is no page. It gets the severity
            // of a missing page in words of its own, and is never read.
            const roots = [
              compiler.options.context as string,
              projectDir
            ].filter(Boolean)
            const withheld =
              fs.existsSync(resolved) && !sourceFileMayShip(resolved, roots)

            if (withheld || !fs.existsSync(resolved)) {
              // A ref that public/ owns is served verbatim at the output root;
              // nothing to compile and nothing missing.
              const relToProject = path.relative(projectDir, resolved)

              if (
                !withheld &&
                relToProject &&
                !relToProject.startsWith('..') &&
                !path.isAbsolute(relToProject) &&
                findPublicFile(
                  this.manifestPath,
                  compiler.options.context,
                  relToProject
                )
              ) {
                continue
              }

              const manifestField = featureName.startsWith('pages/')
                ? undefined
                : manifestFieldForHtmlFeature(
                    featureName,
                    this.manifestPath,
                    this.browser
                  )

              const withheldMessage = withheld
                ? messages.pageFileWithheld(
                    {manifestField, pageName: featureName},
                    path
                      .relative(projectDir, resolved)
                      .split(path.sep)
                      .join('/'),
                    withheldEntryKind(resolved, roots),
                    resolved
                  )
                : undefined

              if (!manifestField) {
                // A page of the pages folder or one only a script opens: the
                // browser loads the extension without it, so a dead one warns.
                reportToCompilation(
                  compilation,
                  compiler,
                  withheldMessage ||
                    messages.pageFileMissing(featureName, resolved),
                  process.env.EXTENSION_STRICT_REFS === 'true'
                    ? 'error'
                    : 'warning',
                  undefined,
                  'ManifestPageMissing'
                )
              } else {
                // Chrome refuses to load an extension whose popup/options/devtools/background
                // page is missing; fail the build the same way. Sandbox/sidebar only warn.
                const isLoadChecked =
                  !featureName.startsWith('sandbox/') &&
                  featureName !== 'sidebar/index' &&
                  featureName !== 'sidebar_action/index'

                reportToCompilation(
                  compilation,
                  compiler,
                  withheldMessage ||
                    messages.manifestPageMissing(manifestField, resolved),
                  isLoadChecked ? 'error' : 'warning',
                  'manifest.json',
                  'ManifestPageMissing'
                )

                if (!isLoadChecked) {
                  markPageReportedMissing(
                    compilation,
                    getFilePath(featureName, '.html', false)
                  )
                }
              }

              continue
            }

            const read = readHtml(resolved)
            const rawSource = new sources.RawSource(read.text)
            const filepath = getFilePath(featureName, '.html', false)
            // The asset names the file it was read from, for whoever maps an
            // emitted page back to its source.
            const sourceFilename = path
              .relative(
                String(compiler.options.context || projectDir),
                resolved
              )
              .replace(/\\/g, '/')
            compilation.emitAsset(filepath, rawSource, {sourceFilename})

            if (read.outcome !== 'utf-8') {
              reportToCompilation(
                compilation,
                compiler,
                read.outcome === 'converted'
                  ? messages.pageConvertedToUtf8(
                      sourceFilename,
                      String(read.declared)
                    )
                  : messages.pageNotUtf8(sourceFilename, read.declared),
                'warning',
                sourceFilename,
                'HtmlPageNotUtf8'
              )
            }
          }
        }
      }

      compilation.hooks.processAssets.tap(
        {
          name: 'html:emit-html-file',
          stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL
        },
        () => runner()
      )
    })
  }
}

// Whether web_accessible_resources names this page by its literal path.
function isWebAccessiblePage(
  manifest: Record<string, unknown>,
  featureName: string
): boolean {
  const declared = manifest.web_accessible_resources
  if (!Array.isArray(declared)) return false

  return declared
    .flatMap((entry) =>
      typeof entry === 'string'
        ? [entry]
        : Array.isArray(entry?.resources)
          ? entry.resources
          : []
    )
    .some(
      (resource) =>
        typeof resource === 'string' &&
        resource.replace(/^\.?\/+/, '').replace(/\.html$/i, '') === featureName
    )
}

// Map an HTML includeList feature key back to the manifest field the user
// wrote. The manifest is filtered for the target browser first, the same
// view the include list was built from, so a firefox: key never labels a
// chrome build. A page only a script names has no field and maps to none.
export function manifestFieldForHtmlFeature(
  featureName: string,
  manifestPath: string,
  browser?: PluginInterface['browser']
): string | undefined {
  let manifest: Record<string, unknown> = {}

  try {
    manifest = filterKeysForThisBrowser(
      readManifest(manifestPath),
      browser || 'chrome'
    ) as Record<string, unknown>
  } catch {
    // fall through to positional labels
  }

  const has = (key: string) => key in manifest

  // Both engines read options_ui.page before the legacy key (optionsPageRef
  // in shared/html-surfaces), and the build compiles that source, so the
  // label has to name the same one.
  const hasOptionsUiPage = () => {
    const page = (manifest.options_ui as {page?: unknown} | undefined)?.page

    return typeof page === 'string' && page.trim().length > 0
  }

  if (featureName.startsWith('chrome_url_overrides/')) {
    return featureName.replace('/', '.')
  }

  if (featureName.startsWith('sandbox/')) return 'sandbox.pages'

  switch (featureName) {
    case 'action/index':
      if (has('action')) return 'action.default_popup'
      if (has('browser_action')) return 'browser_action.default_popup'

      return 'page_action.default_popup'
    case 'browser_action/index':
      return 'browser_action.default_popup'
    case 'page_action/index':
      return 'page_action.default_popup'
    case 'options/index':
      return hasOptionsUiPage() || !has('options_page')
        ? 'options_ui.page'
        : 'options_page'
    case 'background/index':
      return 'background.page'
    case 'devtools/index':
      return 'devtools_page'
    case 'sidebar/index':
      return has('side_panel')
        ? 'side_panel.default_path'
        : 'sidebar_action.default_panel'
    case 'sidebar_action/index':
      return 'sidebar_action.default_panel'
    default:
      if (/^chrome_settings_overrides\/startup-\d+$/.test(featureName)) {
        return 'chrome_settings_overrides.startup_pages'
      }

      return isWebAccessiblePage(manifest, featureName)
        ? 'web_accessible_resources'
        : undefined
  }
}
