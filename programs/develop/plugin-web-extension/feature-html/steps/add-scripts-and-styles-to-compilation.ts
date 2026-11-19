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
import {getDevServerHmrImports} from '../../../lib/dev-server-client-import'
import {resolveDevelopDistFile} from '../../../lib/develop-context'
import type {FilepathList, PluginInterface} from '../../../types'
import {EXTENSIONJS_SANDBOX_LAYER} from '../../feature-scripts/contracts'
import {classicConcatEntry, isClassicScript} from '../../shared/classic-concat'
import {sourceMayShip} from '../html-lib/source-may-ship'
import * as htmlUtils from '../html-lib/utils'

export class AddScriptsAndStylesToCompilation {
  public readonly manifestPath: string
  public readonly includeList?: FilepathList
  public readonly browser?: string
  public readonly connectableHost?: string
  public readonly port?: string | number

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList
    this.browser = options.browser
    this.connectableHost = options.connectableHost
    this.port = options.port
  }

  public apply(compiler: Compiler) {
    const htmlEntries = this.includeList || {}
    const manifestDir = path.dirname(this.manifestPath)
    const projectRoot = (compiler.options.context as string) || manifestDir
    const devServerHmrImports =
      compiler.options.mode === 'development'
        ? getDevServerHmrImports(compiler, {
            connectableHost: this.connectableHost,
            port: this.port
          })
        : []

    // The dev client opens its socket through this class, which names the
    // page it shows, so a saved page reloads only the tabs showing it.
    if (devServerHmrImports.length > 0) {
      const ProvidePlugin = compiler.rspack?.ProvidePlugin

      if (ProvidePlugin) {
        new ProvidePlugin({
          __rspack_dev_server_client__:
            resolveDevelopDistFile('page-socket-client')
        }).apply(compiler)
      }
    }

    for (const field of Object.entries(htmlEntries)) {
      const [feature, resource] = field

      if (resource) {
        if (!fs.existsSync(resource as string)) continue

        const htmlAssets = htmlUtils.getAssetsFromHtml(resource as string)
        // Parity with special-folders and @feature-scripts: exclude only public-root
        // URL refs (leading '/') that do NOT exist on disk; remote URLs too.
        const isRemoteUrl = (p: string) => /^(https?:)?\/\//i.test(p)
        // A leading '/' is an EXTENSION-ROOT reference (Chrome semantics), never a
        // module to bundle; the file is served from the output root instead.
        const looksLikePublicRootUrl = (p: string) =>
          p.startsWith('/public/') ||
          htmlUtils.isWrittenAsRootUrl(p, projectRoot, htmlAssets?.authored)
        // Chrome silently 404s a missing <script src>/<link href> and runs the page;
        // drop missing local files from the entry instead of failing the build.
        const isMissingLocalFile = (p: string) =>
          path.isAbsolute(p) && !fs.existsSync(p)
        // The bundler compiles an entry into the page's bundle, so a file
        // the build never copies is dropped here, before it is one.
        const isWithheld = (p: string) =>
          path.isAbsolute(p) && !sourceMayShip(p, projectRoot, manifestDir)
        const isEntry = (asset: string) =>
          !looksLikePublicRootUrl(asset) &&
          !isRemoteUrl(asset) &&
          !isMissingLocalFile(asset) &&
          !isWithheld(asset)
        const jsAssets = (htmlAssets?.js || []).filter(isEntry)
        const cssAssets = (htmlAssets?.css || []).filter(isEntry)

        // Classic <script src> tags share one global scope; when every page script is
        // classic (or one classic file has inline consumers), use the classic-concat loader.
        const moduleJsAssets = new Set(htmlAssets?.moduleJs || [])
        const hasInlineScript = (() => {
          try {
            const html = fs.readFileSync(resource as string, 'utf8')
            const inlineRe =
              /<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi
            let match: RegExpExecArray | null

            while ((match = inlineRe.exec(html))) {
              if (match[1]?.trim()) return true
            }
          } catch {
            // Ignore
          }

          return false
        })()
        const concatenateClassic =
          (jsAssets.length > 1 || (jsAssets.length === 1 && hasInlineScript)) &&
          jsAssets.every(
            (asset) =>
              !moduleJsAssets.has(asset) &&
              /\.(js|cjs)$/i.test(asset) &&
              isClassicScript(asset)
          )
        const jsImports = concatenateClassic
          ? [classicConcatEntry(feature, jsAssets)]
          : jsAssets

        const fileAssets = [...jsImports, ...cssAssets]

        if (compiler.options.mode === 'development') {
          if (devServerHmrImports.length > 0) {
            fileAssets.unshift(...devServerHmrImports)
          }

          // The refresh shim must run before any refresh-transformed user module; it's a
          // no-op fallback that keeps the bundle from crashing when the plugin is broken.
          fileAssets.unshift(resolveDevelopDistFile('preact-refresh-shim'))

          // you can't HMR without a .js file, so we add a minimum script file
          const hmrScript = resolveDevelopDistFile('minimum-script-file')
          fileAssets.push(hmrScript)
        }

        if (fs.existsSync(resource as string)) {
          compiler.options.entry = {
            ...compiler.options.entry,
            [feature]: {
              import: fileAssets,
              ...(feature.startsWith('sandbox/')
                ? {layer: EXTENSIONJS_SANDBOX_LAYER}
                : {})
            }
          }
        }
      }
    }
  }
}
