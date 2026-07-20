// ██╗  ██╗████████╗███╗   ███╗██╗
// ██║  ██║╚══██╔══╝████╗ ████║██║
// ███████║   ██║   ██╔████╔██║██║
// ██╔══██║   ██║   ██║╚██╔╝██║██║
// ██║  ██║   ██║   ██║ ╚═╝ ██║███████╗
// ╚═╝  ╚═╝   ╚═╝   ╚═╝     ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {type Compilation, WebpackError} from '@rspack/core'
import * as parse5utilities from 'parse5-utilities'
import {injectCssLink} from '../../../plugin-css/css-lib/inject-css-link'
import {resolveCssAsset} from '../../../plugin-css/css-lib/resolve-css-asset'
import type {FilepathList} from '../../../types'
import {handleStaticAsset} from './assets'
import {injectJsScript} from './inject'
import * as messages from './messages'
import {parseHtml} from './parse-html'
import {
  cleanAssetUrl,
  getBaseHref,
  getExtname,
  getFilePath,
  joinEmittedAssetName
} from './utils'

function warnIfPublicRootAssetMissing(
  compilation: Compilation,
  htmlEntry: string,
  cleanPath: string
): void {
  const projectDir = path.dirname(path.dirname(htmlEntry))
  const publicCandidate = path.join(projectDir, 'public', cleanPath.slice(1))

  if (fs.existsSync(publicCandidate)) return

  const warn = new WebpackError(
    messages.fileNotFound(htmlEntry, cleanPath)
  ) as Error & {name?: string; file?: string}
  warn.name = 'HtmlPublicAssetMissing'
  warn.file = htmlEntry

  const filtered = String(warn.message)
    .split('\n')
    .filter((line) => !line.includes(String(cleanPath)))
  warn.message = filtered.join('\n').trim()

  compilation.warnings.push(warn)
}

export function patchHtml(
  compilation: Compilation,
  feature: string,
  htmlEntry: string,
  includeList: FilepathList
): string {
  const htmlFile = fs.readFileSync(htmlEntry, {encoding: 'utf8'})
  const htmlDocument = parse5utilities.parse(htmlFile)
  const baseHref = getBaseHref(htmlDocument)

  const cssAsset = resolveCssAsset(compilation, feature)
  let hasCssEntry = cssAsset.found
  const cssHrefOverride = cssAsset.href

  let hasJsEntry = false
  let firstScriptAttrs: Array<{name: string; value: string}> | undefined
  let firstLinkAttrs: Array<{name: string; value: string}> | undefined
  // Bundled <script src> tags collected during the walk. The bundle tag replaces
  // the LAST of them IN PLACE so inline consumers below still find it executed.
  const bundledScriptNodes: parse5utilities.ParsedNode[] = []
  let bodyNode: Parameters<typeof parse5utilities.append>[0] | undefined

  for (const node of htmlDocument.childNodes) {
    if (node.nodeName !== 'html') continue

    for (const htmlChildNode of node.childNodes) {
      if (
        htmlChildNode.nodeName === 'head' ||
        htmlChildNode.nodeName === 'body'
      ) {
        parseHtml(htmlChildNode, ({filePath, childNode, assetType}) => {
          const htmlDir = path.dirname(htmlEntry)
          const {cleanPath, hash, search} = cleanAssetUrl(filePath)
          const absolutePath = path.resolve(htmlDir, cleanPath)
          const extname = getExtname(absolutePath)

          const excludedFilePath =
            path.posix.join('/', cleanPath) + (search || '') + (hash || '')

          let thisChildNode: parse5utilities.ParsedNode = childNode

          switch (assetType) {
            case 'script': {
              if (cleanPath.startsWith('/')) {
                thisChildNode = parse5utilities.setAttribute(
                  thisChildNode,
                  'src',
                  cleanPath + (search || '') + (hash || '')
                )
              } else {
                if (!firstScriptAttrs) {
                  firstScriptAttrs = Array.isArray(
                    (thisChildNode as {attrs?: unknown}).attrs
                  )
                    ? [
                        ...(
                          thisChildNode as {
                            attrs: Array<{name: string; value: string}>
                          }
                        ).attrs
                      ]
                    : []
                }
                bundledScriptNodes.push(thisChildNode)
                hasJsEntry = true
              }
              break
            }
            case 'css': {
              if (cleanPath.startsWith('/')) {
                thisChildNode = parse5utilities.setAttribute(
                  thisChildNode,
                  'href',
                  cleanPath + (search || '') + (hash || '')
                )
              } else {
                if (!firstLinkAttrs) {
                  firstLinkAttrs = Array.isArray(
                    (thisChildNode as {attrs?: unknown}).attrs
                  )
                    ? [
                        ...(
                          thisChildNode as {
                            attrs: Array<{name: string; value: string}>
                          }
                        ).attrs
                      ]
                    : []
                }
                thisChildNode = parse5utilities.remove(
                  thisChildNode as Parameters<typeof parse5utilities.remove>[0]
                )
                hasCssEntry = true
              }
              break
            }
            case 'staticHref':
            case 'staticSrc': {
              thisChildNode = handleStaticAsset(
                compilation,
                htmlEntry,
                htmlDir,
                absolutePath,
                assetType,
                cleanPath,
                search,
                hash,
                baseHref,
                includeList,
                extname,
                thisChildNode
              )
              break
            }
            default:
              break
          }
        })
      }

      if (htmlChildNode.nodeName === 'head') {
        if (hasCssEntry) {
          injectCssLink(htmlChildNode, feature, firstLinkAttrs, cssHrefOverride)
        }
      }

      if (htmlChildNode.nodeName === 'body') {
        bodyNode = htmlChildNode as Parameters<typeof parse5utilities.append>[0]
      }
    }

    // Create the script tag for the JS bundle. We want a single JS entry
    // point for the extension even during development.
    if (hasJsEntry || compilation.options.mode !== 'production') {
      if (bundledScriptNodes.length > 0) {
        // Swap the last original tag for the bundle tag in place; drop the rest.
        // Execution order relative to inline and preserved tags stays the author's.
        for (const scriptNode of bundledScriptNodes.slice(0, -1)) {
          parse5utilities.remove(
            scriptNode as Parameters<typeof parse5utilities.remove>[0]
          )
        }
        const lastScriptNode = bundledScriptNodes[
          bundledScriptNodes.length - 1
        ] as ReturnType<typeof parse5utilities.createNode>
        const propagateScriptAttrs = new Set(['type', 'defer', 'async'])
        lastScriptNode.attrs = [
          {name: 'src', value: getFilePath(feature, '.js', true)},
          ...(firstScriptAttrs || []).filter((attr) =>
            propagateScriptAttrs.has(attr.name)
          )
        ]
      } else if (bodyNode) {
        injectJsScript(bodyNode, feature, firstScriptAttrs)
      }
    }

    return parse5utilities.stringify(htmlDocument)
  }

  return ''
}

// Patches a nested HTML: preserve original script/link tags, rewrite only
// static assets, and warn about missing public-root assets.
export function patchHtmlNested(
  compilation: Compilation,
  htmlEntry: string
): string {
  const htmlFile = fs.readFileSync(htmlEntry, {encoding: 'utf8'})
  const htmlDocument = parse5utilities.parse(htmlFile)

  for (const node of htmlDocument.childNodes) {
    if (node.nodeName !== 'html') continue

    for (const htmlChildNode of node.childNodes) {
      if (
        htmlChildNode.nodeName === 'head' ||
        htmlChildNode.nodeName === 'body'
      ) {
        parseHtml(htmlChildNode, ({filePath, childNode, assetType}) => {
          const htmlDir = path.dirname(htmlEntry)
          const {cleanPath, hash, search} = cleanAssetUrl(filePath)
          const absolutePath = path.resolve(htmlDir, cleanPath)

          let thisChildNode: parse5utilities.ParsedNode = childNode

          switch (assetType) {
            case 'script': {
              if (cleanPath.startsWith('/')) {
                warnIfPublicRootAssetMissing(compilation, htmlEntry, cleanPath)

                thisChildNode = parse5utilities.setAttribute(
                  thisChildNode,
                  'src',
                  cleanPath + (search || '') + (hash || '')
                )
              }

              break
            }

            case 'css': {
              if (cleanPath.startsWith('/')) {
                warnIfPublicRootAssetMissing(compilation, htmlEntry, cleanPath)
                thisChildNode = parse5utilities.setAttribute(
                  thisChildNode,
                  'href',
                  cleanPath + (search || '') + (hash || '')
                )
              }
              break
            }
            case 'staticHref':
            case 'staticSrc': {
              if (cleanPath.startsWith('/')) {
                warnIfPublicRootAssetMissing(compilation, htmlEntry, cleanPath)
                thisChildNode = parse5utilities.setAttribute(
                  thisChildNode,
                  assetType === 'staticSrc' ? 'src' : 'href',
                  cleanPath + (search || '') + (hash || '')
                )
              } else {
                if (fs.existsSync(absolutePath)) {
                  const relativeFromHtml = path.relative(htmlDir, absolutePath)
                  const posixRelative = relativeFromHtml
                    .split(path.sep)
                    .join('/')
                  const filepath = joinEmittedAssetName('assets', posixRelative)
                  thisChildNode = parse5utilities.setAttribute(
                    thisChildNode,
                    assetType === 'staticSrc' ? 'src' : 'href',
                    getFilePath(filepath, '', true) +
                      (search || '') +
                      (hash || '')
                  )
                }
              }
              break
            }
            default:
              break
          }
        })
      }

      return parse5utilities.stringify(htmlDocument)
    }
  }

  return ''
}
