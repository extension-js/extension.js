//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {htmlStaticAssetOutputName} from '../../plugin-web-extension/feature-html/html-lib/utils'
import {replaceCssUrlRefs, toPosixPath} from './dead-url-refs'

export const EXTENSION_ROOT_PLACEHOLDER = '__EXTENSIONJS_EXTENSION_ROOT__/'

export interface InlinedCssUrlTarget {
  request: string
  absolutePath: string
  outputName: string
  // A file under public/ already ships at the dist root through the public
  // copier, under the same name. Emitting it again would ship it twice.
  publicOwned: boolean
}

export interface RewriteInlinedCssUrlsContext {
  resourcePath: string
  manifestDir: string
  // The folder the public copier ships from, so names agree with its output.
  publicRoot: string
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
  {resourcePath, manifestDir, publicRoot}: RewriteInlinedCssUrlsContext
):
  | {absolutePath: string; outputName: string; publicOwned: boolean}
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

    return {
      absolutePath: fromManifest,
      outputName: htmlStaticAssetOutputName(
        manifestDir,
        resourcePath,
        fromManifest
      ),
      publicOwned: false
    }
  }

  const absolutePath = path.resolve(path.dirname(resourcePath), req)
  if (!isFile(absolutePath)) return undefined

  return {
    absolutePath,
    outputName: htmlStaticAssetOutputName(
      manifestDir,
      resourcePath,
      absolutePath
    ),
    publicOwned: false
  }
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

    let outputName = seen.get(req)

    if (!outputName) {
      const target = resolveTarget(req, context)
      if (!target) return undefined

      outputName = target.outputName
      seen.set(req, outputName)
      targets.push({request: req, ...target})
    }

    return `${EXTENSION_ROOT_PLACEHOLDER}${outputName}${suffix}`
  })

  return {css, targets}
}

export function toRuntimeStylesheetModule(css: string): string {
  return [
    `var __extjsCssText = ${JSON.stringify(css)};`,
    'function __extjsExtensionRoot() {',
    '  try {',
    '    if (typeof browser === "object" && browser && browser.runtime && typeof browser.runtime.getURL === "function") return String(browser.runtime.getURL("/"));',
    '  } catch (error) {}',
    '  try {',
    '    if (typeof chrome === "object" && chrome && chrome.runtime && typeof chrome.runtime.getURL === "function") return String(chrome.runtime.getURL("/"));',
    '  } catch (error) {}',
    // A MAIN-world script has no runtime API. The bridge publishes the
    // extension base for it on globalThis and on <html>, as public path reads.
    '  try {',
    '    var base = (typeof globalThis === "object" && globalThis && globalThis.__EXTJS_EXTENSION_BASE__) ? String(globalThis.__EXTJS_EXTENSION_BASE__) : "";',
    '    if (!base && typeof document === "object" && document && document.documentElement) base = String(document.documentElement.getAttribute("data-extjs-extension-base") || "");',
    '    if (base) return base.replace(/\\/+$/, "") + "/";',
    '  } catch (error) {}',
    '  return "/";',
    '}',
    `module.exports = "data:text/css;charset=utf-8," + encodeURIComponent(__extjsCssText.split(${JSON.stringify(EXTENSION_ROOT_PLACEHOLDER)}).join(__extjsExtensionRoot()));`,
    ''
  ].join('\n')
}
