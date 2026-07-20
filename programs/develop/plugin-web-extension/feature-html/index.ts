// ██╗  ██╗████████╗███╗   ███╗██╗
// ██║  ██║╚══██╔══╝████╗ ████║██║
// ███████║   ██║   ██╔████╔██║██║
// ██╔══██║   ██║   ██║╚██╔╝██║██║
// ██║  ██║   ██║   ██║ ╚═╝ ██║███████╗
// ╚═╝  ╚═╝   ╚═╝   ╚═╝     ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import type {Compiler} from '@rspack/core'
import {resolveDevelopDistFile} from '../../lib/develop-context'
import {parseJsonSafe} from '../../lib/parse-json-safe'
import {toResourceKey} from '../../lib/resource-path'
import type {DevOptions, FilepathList, PluginInterface} from '../../types'
import {EXTENSIONJS_CONTENT_SCRIPT_LAYER} from '../feature-scripts/contracts'
import {AddAssetsToCompilation} from './steps/add-assets-to-compilation'
import {AddScriptsAndStylesToCompilation} from './steps/add-scripts-and-styles-to-compilation'
import {AddToFileDependencies} from './steps/add-to-file-dependencies'
import {EmitHtmlFile} from './steps/emit-html-file'
import {HandleCommonErrors} from './steps/handle-common-errors'
import {ThrowIfRecompileIsNeeded} from './steps/throw-if-recompile-is-needed'
import {UpdateHtmlFile} from './steps/update-html-file'

/**
 * HtmlPlugin is responsible for handling the HTML file
 * defined in the manifest.json. Static assets and CSS files
 * within the HTML file are added to the compilation. JS files
 * are added as webpack entrypoints. It also supports ecxtra
 * html files defined via this.include option. These extra
 * html files are added to the compilation and are also HMR
 * enabled. They are useful for adding extra pages to the
 * extension runtime that are not defined in manifest.
 *
 * The plugin also has a guard against recompiling entrypoints
 * at runtime, throwing an error if any of those files change.
 *
 * Features supported:
 * action.default_popup - HMR enabled
 * background.page - HMR enabled
 * chrome_settings_overrides.homepage - HMR enabled
 * chrome_url_overrides.newtab - HMR enabled
 * chrome_url_overrides.history - HMR enabled
 * chrome_url_overrides.bookmarks - HMR enabled
 * devtools_page - HMR enabled
 * options_ui.page - HMR enabled
 * page_action.default_popup - HMR enabled
 * sandbox.page - HMR enabled
 * side_panel.default_panel - HMR enabled
 * sidebar_action.default_panel - HMR enabled
 */
export class HtmlPlugin {
  public readonly manifestPath: string
  public readonly includeList?: FilepathList
  private readonly browser: DevOptions['browser']

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList
    this.browser = options.browser || 'chrome'
  }

  public apply(compiler: Compiler): void {
    const includeList = {
      ...(this.includeList || {})
    }

    new EmitHtmlFile({
      manifestPath: this.manifestPath,
      includeList,
      browser: this.browser
    }).apply(compiler)

    new AddAssetsToCompilation({
      manifestPath: this.manifestPath,
      includeList,
      browser: this.browser
    }).apply(compiler)

    new AddScriptsAndStylesToCompilation({
      manifestPath: this.manifestPath,
      includeList,
      browser: this.browser
    }).apply(compiler)

    new UpdateHtmlFile({
      manifestPath: this.manifestPath,
      includeList,
      browser: this.browser
    }).apply(compiler)

    if ((compiler.options.mode || 'development') !== 'production') {
      const contentScriptEntryPaths = new Set<string>()
      try {
        const manifest = parseJsonSafe(
          fs.readFileSync(this.manifestPath, 'utf-8')
        )
        const manifestDir = path.dirname(this.manifestPath)
        const contentScripts = Array.isArray(manifest?.content_scripts)
          ? manifest.content_scripts
          : []

        for (const contentScript of contentScripts) {
          const jsList = Array.isArray(contentScript?.js)
            ? contentScript.js
            : []

          for (const jsFile of jsList) {
            contentScriptEntryPaths.add(
              toResourceKey(path.resolve(manifestDir, jsFile))
            )
          }
        }
      } catch {
        // Keep the HTML HMR rule active if manifest parsing fails.
      }

      compiler.options.module.rules.push({
        test: /\.(js|cjs|mjs|jsx|mjsx|ts|mts|tsx|mtsx)$/,
        include: [path.dirname(this.manifestPath)],
        issuerLayer: {not: EXTENSIONJS_CONTENT_SCRIPT_LAYER},
        exclude: [
          /([\\/])node_modules\1/,
          (resourcePath: string) =>
            contentScriptEntryPaths.has(toResourceKey(resourcePath))
        ],
        use: [
          {
            loader: resolveDevelopDistFile('ensure-hmr-for-scripts'),
            options: {
              manifestPath: this.manifestPath,
              includeList
            }
          }
        ]
      })
    }

    new AddToFileDependencies({
      manifestPath: this.manifestPath,
      includeList,
      browser: this.browser
    }).apply(compiler)

    // Suggest recompiling when a style or script path inside the HTML changed;
    // entrypoints can't be recompiled at runtime.
    new ThrowIfRecompileIsNeeded({
      manifestPath: this.manifestPath,
      includeList,
      browser: this.browser
    }).apply(compiler)

    new HandleCommonErrors({
      manifestPath: this.manifestPath,
      includeList,
      browser: this.browser
    }).apply(compiler)
  }
}
