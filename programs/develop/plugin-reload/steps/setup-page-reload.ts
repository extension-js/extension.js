// ██████╗ ███████╗██╗      ██████╗  █████╗ ██████╗
// ██╔══██╗██╔════╝██║     ██╔═══██╗██╔══██╗██╔══██╗
// ██████╔╝█████╗  ██║     ██║   ██║███████║██║  ██║
// ██╔══██╗██╔══╝  ██║     ██║   ██║██╔══██║██║  ██║
// ██║  ██║███████╗███████╗╚██████╔╝██║  ██║██████╔╝
// ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import type {Compiler} from '@rspack/core'
import {
  getDevServerHmrImports,
  resolveStockSocketClientPath
} from '../../lib/dev-server-client-import'
import {resolveDevelopDistFile} from '../../lib/develop-context'
import {filterKeysForThisBrowser} from '../../lib/manifest-utils'
import {debugLine} from '../../lib/messaging'
import {parseJsonSafe} from '../../lib/parse-json-safe'
import {toResourceKey} from '../../lib/resource-path'
import {NOT_RAW_RESOURCE_QUERY} from '../../lib/resource-query'
import {isUsingReact} from '../../plugin-js-frameworks/js-tools/react'
import {isUsingSvelte} from '../../plugin-js-frameworks/js-tools/svelte'
import {isUsingVue} from '../../plugin-js-frameworks/js-tools/vue'
import {EXTENSIONJS_CONTENT_SCRIPT_LAYER} from '../../plugin-web-extension/feature-scripts/contracts'
import {
  extendHtmlPages,
  type HtmlPage
} from '../../plugin-web-extension/shared/html-page-extensions'
import type {DevOptions, PluginInterface} from '../../types'

type PageEntry = {import?: string[]}

// Gives every page of a development build its hot update client, and lets
// the scripts a page names accept their own update in a dev session.
export class SetupPageReload {
  public static readonly name = 'plugin-reload-pages'

  private readonly manifestPath: string
  private readonly browser: DevOptions['browser']
  private readonly devSession?: boolean
  private readonly connectableHost?: string
  private readonly port?: string | number

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
    this.devSession = options.devSession
    this.connectableHost = options.connectableHost
    this.port = options.port
  }

  // Applied before the pages are declared, so the additions land where the
  // pages plugin sits in the plugin order and every later rule follows them.
  public apply(compiler: Compiler): void {
    extendHtmlPages(compiler, {
      pagesDeclared: (declaring, pages) => {
        this.addClientToEntries(declaring, pages)
        this.acceptPageScriptUpdates(declaring, pages)
      }
    })
  }

  private addClientToEntries(compiler: Compiler, pages: readonly HtmlPage[]) {
    if (compiler.options.mode !== 'development') return

    const devServerHmrImports = getDevServerHmrImports(compiler, {
      connectableHost: this.connectableHost,
      port: this.port
    })

    // The dev server provides its stock socket class to the client. Pointing
    // that file at ours names the page, so a saved page reloads only its tabs.
    const stockSocketClient =
      devServerHmrImports.length > 0
        ? resolveStockSocketClientPath()
        : undefined

    if (stockSocketClient) {
      const resolve = (compiler.options.resolve ||= {})
      resolve.alias = {
        ...(resolve.alias as Record<string, string | false | string[]>),
        [`${stockSocketClient}$`]: resolveDevelopDistFile('page-socket-client')
      }
    }

    const entries = compiler.options.entry as Record<string, PageEntry>

    for (const page of pages) {
      const entry = entries[page.entry]
      if (!entry) continue

      entry.import = [
        // The refresh shim runs before any refresh-transformed module, so a
        // bundle whose refresh plugin is broken still loads.
        resolveDevelopDistFile('preact-refresh-shim'),
        ...devServerHmrImports,
        ...(entry.import || []),
        // A page with no script of its own still needs one to hot update.
        resolveDevelopDistFile('minimum-script-file')
      ]
    }
  }

  private acceptPageScriptUpdates(
    compiler: Compiler,
    pages: readonly HtmlPage[]
  ) {
    const devSession =
      this.devSession ??
      (compiler.options.mode || 'development') !== 'production'

    if (!devSession) return

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
        const jsList = Array.isArray(contentScript?.js) ? contentScript.js : []

        for (const jsFile of jsList) {
          contentScriptEntryPaths.add(
            toResourceKey(path.resolve(manifestDir, jsFile))
          )
        }
      }
    } catch {
      // A manifest that does not parse is reported by the manifest feature,
      // and the page rule works without the list of content scripts.
    }

    const projectRoot = String(compiler.options.context || '')

    // The scripts a page names are the only modules that accept their own
    // update. A background script or any other entry has no page to redraw.
    const pageScripts = new Set<string>(
      pages.flatMap((page) =>
        page.scripts.map((script) => toResourceKey(script))
      )
    )

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

    if (frameworkOwnsRefresh || pageScripts.size === 0) return

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
          options: {manifestPath: this.manifestPath}
        }
      ]
    })
  }
}
