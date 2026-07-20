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
import {classicConcatEntry, isClassicScript} from '../../shared/classic-concat'
import * as htmlUtils from '../html-lib/utils'

export class AddScriptsAndStylesToCompilation {
  public readonly manifestPath: string
  public readonly includeList?: FilepathList
  public readonly browser?: string

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList
    this.browser = options.browser
  }

  public apply(compiler: Compiler) {
    const htmlEntries = this.includeList || {}
    const manifestDir = path.dirname(this.manifestPath)
    const projectRoot = (compiler.options.context as string) || manifestDir
    const devServerHmrImports =
      compiler.options.mode === 'development'
        ? getDevServerHmrImports(compiler)
        : []

    for (const field of Object.entries(htmlEntries)) {
      const [feature, resource] = field

      // Resources from the manifest lib can come as undefined.
      if (resource) {
        if (!fs.existsSync(resource as string)) continue

        const htmlAssets = htmlUtils.getAssetsFromHtml(resource as string)
        // Parity with special-folders and @feature-scripts:
        // Exclude only public-root URL references (leading '/') that do NOT
        // exist on disk. Absolute filesystem paths must still be bundled.
        // Remote URLs are excluded as well
        const isRemoteUrl = (p: string) => /^(https?:)?\/\//i.test(p)
        // A leading '/' is an EXTENSION-ROOT reference (Chrome semantics), never
        // a module to bundle, regardless of whether a public/ dir exists. It
        // used to require hasPublicDir, so a root-absolute ref in a project with
        // no public/ was handed to rspack as an entry and died with
        // "Module not found: Can't resolve '/nscl/main.js'". The file is served
        // from the output root instead (public/, or copied from the extension
        // root by emitRootAbsoluteRefs).
        const looksLikePublicRootUrl = (p: string) =>
          p.startsWith('/public/') ||
          (p.startsWith('/') && !p.startsWith(projectRoot))
        // Chrome loads an extension page whose <script src>/<link href>
        // points at a nonexistent file, the reference silently 404s and the
        // rest of the page runs. Handing the ref to rspack as an entry import
        // instead fails the whole build with "Module not found", so a working
        // wild extension can't build unmodified. Drop missing local files
        // from the entry; AddAssetsToCompilation reports each one (warning by
        // default, error under EXTENSION_STRICT_REFS=true).
        const isMissingLocalFile = (p: string) =>
          path.isAbsolute(p) && !fs.existsSync(p)
        const jsAssets = (htmlAssets?.js || []).filter(
          (asset) =>
            !looksLikePublicRootUrl(asset) &&
            !isRemoteUrl(asset) &&
            !isMissingLocalFile(asset)
        )
        const cssAssets = (htmlAssets?.css || []).filter(
          (asset) =>
            !looksLikePublicRootUrl(asset) &&
            !isRemoteUrl(asset) &&
            !isMissingLocalFile(asset)
        )

        // Multiple classic <script src> tags share one global scope in the
        // browser (`var storage` in lib/storage.js is visible to a sibling
        // sidepanel.js). Bundling them as separate ES modules isolates each
        // file and throws ReferenceError at boot. When every page script is
        // classic, no type="module" tag and no top-level import/export,
        // route the group through the classic-concat loader (same contract
        // as multi-file content_scripts) so their sources concatenate into
        // one shared scope, in tag order. CSS stays as bare entry imports so
        // rspack extracts it to the canonical <feature>.css.
        //
        // A SINGLE classic script takes the same route when the page also
        // carries inline <script> content: in the browser the classic file's
        // top-level declarations land on the page global and the inline
        // script consumes them (`Handlebars.compile(...)` beside a
        // <script src> handlebars). Bundling it as an ES module scopes the
        // declarations inside the webpack closure and the inline consumer
        // throws ReferenceError, the concat loader bridges the declarations
        // back onto globalThis. Pages without inline consumers keep the
        // plain bundling path unchanged.
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
            // Unreadable page: keep the default bundling path.
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

          // The refresh shim must run before any user module that the
          // refresh loader transformed (top-level `$RefreshReg$`/`$RefreshSig$`
          // calls). It is a no-op fallback that gets transparently overwritten
          // per-factory when a working refresh plugin is wired up; when the
          // plugin is silently broken (e.g. `@rspack/plugin-preact-refresh@1.1.4`
          // against rspack 2.x, where `runtimeModule.constructorName` is
          // undefined and the intercept is never appended), the shim keeps the
          // user's bundle from crashing on `$RefreshReg$ is not defined`
          fileAssets.unshift(resolveDevelopDistFile('preact-refresh-shim'))

          // you can't HMR without a .js file, so we add a minimum script file
          const hmrScript = resolveDevelopDistFile('minimum-script-file')
          fileAssets.push(hmrScript)
        }

        if (fs.existsSync(resource as string)) {
          compiler.options.entry = {
            ...compiler.options.entry,
            // https://webpack.js.org/configuration/entry-context/#entry-descriptor
            [feature]: {
              import: fileAssets
            }
          }
        }
      }
    }
  }
}
