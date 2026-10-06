//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  publicOwnedOutputName,
  replaceCssUrlRefs,
  toPosixPath
} from './dead-url-refs'

export const EXTENSION_ROOT_PLACEHOLDER = '__EXTENSIONJS_EXTENSION_ROOT__/'

const BUNDLED_FILE_TOKEN = /__EXTENSIONJS_CSS_FILE_(\d+)__([^"\\]*)/g

export function bundledFileToken(index: number): string {
  return `__EXTENSIONJS_CSS_FILE_${index}__`
}

export interface InlinedCssUrlTarget {
  request: string
  absolutePath: string
  // A file under public/ already ships at the dist root through the public
  // copier, under outputName. Any other file is the bundler's to emit and
  // name, as it does for every other sheet, so url() carries a file token.
  publicOwned: boolean
  outputName?: string
}

export interface RewriteInlinedCssUrlsContext {
  resourcePath: string
  manifestDir: string
  // The folder the public copier ships from, so names agree with its output.
  publicRoot: string
  // The same folder when the copier does ship one, for a relative ref into it.
  publicDir?: string
}

function isFile(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isFile()
  } catch {
    return false
  }
}

function resolveTarget(
  req: string,
  {
    resourcePath,
    manifestDir,
    publicRoot,
    publicDir
  }: RewriteInlinedCssUrlsContext
):
  | {absolutePath: string; outputName?: string; publicOwned: boolean}
  | undefined {
  // public/ keeps precedence for a root-absolute ref: it is the documented
  // output-root contract, and the same order the dead-reference scan uses.
  if (req.startsWith('/')) {
    const rel = req.slice(1)
    const fromPublic = path.join(publicRoot, rel)

    if (isFile(fromPublic)) {
      return {
        absolutePath: fromPublic,
        outputName: toPosixPath(path.normalize(rel)),
        publicOwned: true
      }
    }

    const fromManifest = path.join(manifestDir, rel)
    if (!isFile(fromManifest)) return undefined

    return {absolutePath: fromManifest, publicOwned: false}
  }

  const absolutePath = path.resolve(path.dirname(resourcePath), req)
  if (!isFile(absolutePath)) return undefined

  const publicPath = publicOwnedOutputName(absolutePath, publicDir)

  if (publicPath) {
    return {absolutePath, outputName: publicPath, publicOwned: true}
  }

  return {absolutePath, publicOwned: false}
}

export function rewriteInlinedCssUrls(
  source: string,
  context: RewriteInlinedCssUrlsContext
): {css: string; targets: InlinedCssUrlTarget[]} {
  const targets: InlinedCssUrlTarget[] = []
  const seen = new Map<string, string>()

  const css = replaceCssUrlRefs(source, (request) => {
    const suffixAt = request.search(/[?#]/)
    const req = suffixAt === -1 ? request : request.slice(0, suffixAt)
    const suffix = suffixAt === -1 ? '' : request.slice(suffixAt)

    if (!req || req.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(req)) {
      return undefined
    }

    if (req.startsWith('~') || req.startsWith('@')) return undefined
    if (req.startsWith(EXTENSION_ROOT_PLACEHOLDER)) return undefined

    let named = seen.get(req)

    if (!named) {
      const target = resolveTarget(req, context)
      if (!target) return undefined

      named = target.publicOwned
        ? `${EXTENSION_ROOT_PLACEHOLDER}${target.outputName}`
        : bundledFileToken(targets.filter((other) => !other.publicOwned).length)

      seen.set(req, named)
      targets.push({request: req, ...target})
    }

    return `${named}${suffix}`
  })

  return {css, targets}
}

// bundledRequests[n] is the file token n stands for, as a request the bundler
// resolves from the sheet's folder.
export function toRuntimeStylesheetModule(
  css: string,
  bundledRequests: string[] = []
): string {
  const root = JSON.stringify(EXTENSION_ROOT_PLACEHOLDER)
  const rooted = `__extjsCssText.split(${root}).join(__extjsExtensionRoot())`
  const text =
    bundledRequests.length === 0
      ? rooted
      : `${rooted}.replace(${String(BUNDLED_FILE_TOKEN)}, __extjsCssFile)`

  // A bare `browser` gets rewritten into a polyfill require that throws in
  // the MAIN world. Member reads on globalThis are never rewritten.
  return [
    `var __extjsCssText = ${JSON.stringify(css)};`,
    'function __extjsExtensionRoot() {',
    '  try {',
    '    var b = globalThis.browser;',
    '    if (typeof b === "object" && b && b.runtime && typeof b.runtime.getURL === "function") return String(b.runtime.getURL("/"));',
    '  } catch (error) {}',
    '  try {',
    '    var c = globalThis.chrome;',
    '    if (typeof c === "object" && c && c.runtime && typeof c.runtime.getURL === "function") return String(c.runtime.getURL("/"));',
    '  } catch (error) {}',
    // A MAIN-world script has no runtime API. The bridge publishes the
    // extension base for it on globalThis and on <html>, as public path reads.
    '  try {',
    '    var base = (typeof globalThis === "object" && globalThis && globalThis.__EXTJS_EXTENSION_BASE__) ? String(globalThis.__EXTJS_EXTENSION_BASE__) : "";',
    '    if (!base && typeof document === "object" && document && document.documentElement) base = String(document.documentElement.getAttribute("data-extjs-extension-base") || "");',
    // A shipped MAIN-world bundle clears that attribute once it has the base,
    // and keeps it on the require function for a sheet that loads later.
    '    if (!base && typeof __webpack_require__ === "function" && __webpack_require__.extjsBase) base = String(__webpack_require__.extjsBase);',
    '    if (base) return base.replace(/\\/+$/, "") + "/";',
    '  } catch (error) {}',
    '  return "/";',
    '}',
    ...(bundledRequests.length === 0
      ? []
      : [
          // The bundler answers with the file's place under its public path,
          // or a data: URL when it inlined the file. Only the path is kept.
          `var __extjsCssFiles = [${bundledRequests
            .map(
              (request) =>
                `function(){ return new URL(${JSON.stringify(request)}, import.meta.url); }`
            )
            .join(', ')}];`,
          'function __extjsCssFile(match, index, suffix) {',
          '  try {',
          '    var file = __extjsCssFiles[Number(index)]();',
          '    if (file.protocol === "data:") return file.href;',
          '    return __extjsExtensionRoot() + String(file.pathname).replace(/^\\/+/, "") + suffix;',
          '  } catch (error) {}',
          '  return "about:invalid";',
          '}'
        ]),
    `module.exports = "data:text/css;charset=utf-8," + encodeURIComponent(${text});`,
    ''
  ].join('\n')
}
