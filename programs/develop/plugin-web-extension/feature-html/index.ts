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
import {filterKeysForThisBrowser} from '../../lib/manifest-utils'
import {debugLine} from '../../lib/messaging'
import {parseJsonSafe} from '../../lib/parse-json-safe'
import {toResourceKey} from '../../lib/resource-path'
import {NOT_RAW_RESOURCE_QUERY} from '../../lib/resource-query'
import {isUsingReact} from '../../plugin-js-frameworks/js-tools/react'
import {isUsingSvelte} from '../../plugin-js-frameworks/js-tools/svelte'
import {isUsingVue} from '../../plugin-js-frameworks/js-tools/vue'
import type {DevOptions, FilepathList, PluginInterface} from '../../types'
import {EXTENSIONJS_CONTENT_SCRIPT_LAYER} from '../feature-scripts/contracts'
import {getAssetsFromHtml} from './html-lib/utils'
import {AddAssetsToCompilation} from './steps/add-assets-to-compilation'
import {AddScriptsAndStylesToCompilation} from './steps/add-scripts-and-styles-to-compilation'
import {AddToFileDependencies} from './steps/add-to-file-dependencies'
import {EmitHtmlFile} from './steps/emit-html-file'
import {HandleCommonErrors} from './steps/handle-common-errors'
import {PruneReplacedPageAssets} from './steps/prune-replaced-page-assets'
import {ThrowIfRecompileIsNeeded} from './steps/throw-if-recompile-is-needed'
import {UpdateHtmlFile} from './steps/update-html-file'

export class HtmlPlugin {
  public readonly manifestPath: string
  public readonly includeList?: FilepathList
  private readonly browser: DevOptions['browser']
  private readonly devSession?: boolean

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList
    this.devSession = options.devSession
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

    new PruneReplacedPageAssets().apply(compiler)

    new UpdateHtmlFile({
      manifestPath: this.manifestPath,
      includeList,
      browser: this.browser
    }).apply(compiler)

    const devSession =
      this.devSession ??
      (compiler.options.mode || 'development') !== 'production'

    if (devSession) {
      const contentScriptEntryPaths = new Set<string>()

      try {
        // A browser-prefixed key is the only spelling this target sees, so the
        // page HMR loader has to skip content scripts declared under one too.
        const manifest = filterKeysForThisBrowser(
          parseJsonSafe(fs.readFileSync(this.manifestPath, 'utf-8')),
          this.browser
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

      const projectRoot = String(compiler.options.context || '')

      // The scripts a page names are the only modules that accept their own
      // update. A background script or any other entry has no page to redraw.
      const pageScripts = new Set<string>()

      for (const pagePath of Object.values(includeList)) {
        if (typeof pagePath !== 'string' || !fs.existsSync(pagePath)) continue

        for (const script of getAssetsFromHtml(pagePath)?.js || []) {
          if (path.isAbsolute(script)) pageScripts.add(toResourceKey(script))
        }
      }

      // A framework with its own refresh runtime (React Refresh, the Vue and
      // Svelte loaders) owns the page's updates and its mount point, so a
      // page accept here would empty the container underneath it.
      const frameworkOwnsRefresh = Boolean(
        projectRoot &&
          (isUsingReact(projectRoot) ||
            isUsingVue(projectRoot) ||
            isUsingSvelte(projectRoot))
      )

      const debugHtmlHmr = process.env.EXTENSION_DEBUG_HTML_HMR_SKIP === '1'

      if (frameworkOwnsRefresh && debugHtmlHmr) {
        debugLine('[extjs:html-hmr] skip rule, a framework owns refresh')
      }

      if (!frameworkOwnsRefresh && pageScripts.size > 0) {
        compiler.options.module.rules.push({
          test: /\.(js|cjs|mjs|jsx|mjsx|ts|mts|tsx|mtsx)$/,
          include: (resourcePath: string) =>
            pageScripts.has(toResourceKey(resourcePath)),
          issuerLayer: {not: EXTENSIONJS_CONTENT_SCRIPT_LAYER},
          // Only an entry (no issuer) accepts its own update. A child that
          // self-accepts re-runs alone and the entry never renders it again.
          issuer: (issuer: string) => {
            if (!issuer) return true

            if (debugHtmlHmr) {
              debugLine(`[extjs:html-hmr] skip child issuer=${issuer}`)
            }

            return false
          },
          exclude: [
            /([\\/])node_modules\1/,
            (resourcePath: string) =>
              contentScriptEntryPaths.has(toResourceKey(resourcePath))
          ],
          resourceQuery: NOT_RAW_RESOURCE_QUERY,
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
