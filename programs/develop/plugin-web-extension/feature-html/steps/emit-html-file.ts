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
import {stripBom} from '../../../lib/parse-json-safe'
import type {FilepathList, PluginInterface} from '../../../types'
import {reportToCompilation} from '../../shared/compilation-issues'
import * as messages from '../html-lib/messages'
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
      const processAssetsHook = compilation.hooks?.processAssets
      const runner = () => {
        const htmlFields = Object.entries(this.includeList || {})

        for (const field of htmlFields) {
          const [featureName, resource] = field

          if (resource) {
            if (typeof resource !== 'string') continue
            // Normalize HTML resource path relative to manifest:
            // - Leading "/" means extension root (manifest dir)
            // - Relative paths are resolved from manifest dir
            // - Absolute OS paths are used as-is
            const projectDir = path.dirname(this.manifestPath)
            const resolved = path.isAbsolute(resource)
              ? resource
              : resource.startsWith('/')
                ? path.join(projectDir, resource.slice(1))
                : path.join(projectDir, resource)

            if (!fs.existsSync(resolved)) {
              // A root-absolute ref that public/ owns is served verbatim at
              // the output root by the special-folders pipeline, nothing to
              // compile here and nothing missing.
              const relToProject = path.relative(projectDir, resolved)
              if (
                relToProject &&
                !relToProject.startsWith('..') &&
                !path.isAbsolute(relToProject) &&
                fs.existsSync(path.join(projectDir, 'public', relToProject))
              ) {
                continue
              }
              if (featureName.startsWith('pages/')) {
                // Non-entrypoint HTML (special pages/*) only warns.
                reportToCompilation(
                  compilation,
                  compiler,
                  messages.manifestFieldMessageOnly(featureName),
                  'warning'
                )
              } else {
                // Chrome refuses to load an extension whose popup, options,
                // devtools, background, or override page is missing, fail
                // the build the same way instead of emitting a manifest that
                // points at a page that is never produced. Sandbox/sidebar
                // surfaces are not load-checked by every browser, so they
                // warn instead.
                const isLoadChecked =
                  !featureName.startsWith('sandbox/') &&
                  featureName !== 'sidebar/index'
                reportToCompilation(
                  compilation,
                  compiler,
                  messages.manifestPageMissing(
                    manifestFieldForHtmlFeature(featureName, this.manifestPath),
                    resolved
                  ),
                  isLoadChecked ? 'error' : 'warning',
                  'manifest.json'
                )
              }
              continue
            }
            const rawHtml = fs.readFileSync(resolved, 'utf8')
            const rawSource = new sources.RawSource(rawHtml)
            const filepath = getFilePath(featureName, '.html', false)
            compilation.emitAsset(filepath, rawSource)
          }
        }
      }
      if (processAssetsHook && typeof processAssetsHook.tap === 'function') {
        processAssetsHook.tap(
          {
            name: 'AddAssetsToCompilationPlugin',
            // Derive new assets from the existing assets.
            stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL
          },
          () => runner()
        )
      } else {
        // Fallback for environments without processAssets support (tests)
        runner()
      }
    })
  }
}

/**
 * Map an HTML includeList feature key (the emitted page path, e.g.
 * `action/index`) back to the manifest field the user actually wrote, so
 * missing-file errors point at their own manifest. Field presence is checked
 * browser-prefix tolerant (`chrome:action` counts as `action`).
 */
function manifestFieldForHtmlFeature(
  featureName: string,
  manifestPath: string
): string {
  let manifest: Record<string, any> = {}
  try {
    manifest = JSON.parse(stripBom(fs.readFileSync(manifestPath, 'utf-8')))
  } catch {
    // fall through to positional labels
  }

  const has = (key: string) =>
    Object.keys(manifest).some(
      (manifestKey) => manifestKey === key || manifestKey.endsWith(`:${key}`)
    )

  if (featureName.startsWith('chrome_url_overrides/')) {
    return featureName.replace('/', '.')
  }
  if (featureName.startsWith('sandbox/')) return 'sandbox.pages'

  switch (featureName) {
    case 'action/index':
      if (has('action')) return 'action.default_popup'
      if (has('browser_action')) return 'browser_action.default_popup'
      return 'page_action.default_popup'
    case 'options/index':
      return has('options_page') ? 'options_page' : 'options_ui.page'
    case 'background/index':
      return 'background.page'
    case 'devtools/index':
      return 'devtools_page'
    case 'sidebar/index':
      return has('side_panel')
        ? 'side_panel.default_path'
        : 'sidebar_action.default_panel'
    default:
      return featureName.replace('/', '.')
  }
}
