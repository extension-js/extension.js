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

  // Delegate CSS asset resolution to plugin-css.
  const cssAsset = resolveCssAsset(compilation, feature)
  let hasCssEntry = cssAsset.found
  const cssHrefOverride = cssAsset.href

  let hasJsEntry = false
  let firstScriptAttrs: Array<{name: string; value: string}> | undefined
  let firstLinkAttrs: Array<{name: string; value: string}> | undefined
  // Bundled <script src> tags collected during the walk. The bundle tag
  // replaces the LAST of them IN PLACE (instead of an end-of-body append):
  // classic scripts execute at their tag's position, so an inline <script>
  // consumer below a head-positioned library tag (Handlebars.compile beside
  // a <script src> handlebars) must find the bundle already executed. When
  // the last original tag already sits at the end of body this changes
  // nothing.
  const bundledScriptNodes: any[] = []
  let bodyNode: any

  for (const node of htmlDocument.childNodes) {
    if (node.nodeName !== 'html') continue

    for (const htmlChildNode of node.childNodes) {
      // We don't really care whether the asset is in the head or body
      // element, as long as it's not a regular text node, we're good.
      if (
        htmlChildNode.nodeName === 'head' ||
        htmlChildNode.nodeName === 'body'
      ) {
        parseHtml(htmlChildNode, ({filePath, childNode, assetType}) => {
          const htmlDir = path.dirname(htmlEntry)
          const {cleanPath, hash, search} = cleanAssetUrl(filePath)
          const absolutePath = path.resolve(htmlDir, cleanPath)
          const extname = getExtname(absolutePath)
          // public-root absolute paths are preserved; others become bundled entries

          const excludedFilePath =
            path.posix.join('/', cleanPath) + (search || '') + (hash || '')

          let thisChildNode: any = childNode

          switch (assetType) {
            // For script types, we have two cases:
            // 1. If the file is excluded, we replace the src attribute
            // with the excluded file path (absolute path).
            // 2. If the file is not excluded, we remove the script tag
            // from the HTML file and set the JS bundle index since we compile
            // all JS files into a single bundle.
            case 'script': {
              if (cleanPath.startsWith('/')) {
                // Public-root absolute scripts are preserved as-is
                thisChildNode = parse5utilities.setAttribute(
                  thisChildNode,
                  'src',
                  cleanPath + (search || '') + (hash || '')
                )
              } else {
                if (!firstScriptAttrs) {
                  firstScriptAttrs = Array.isArray((thisChildNode as any).attrs)
                    ? [...(thisChildNode as any).attrs]
                    : []
                }
                bundledScriptNodes.push(thisChildNode)
                hasJsEntry = true
              }
              break
            } // For CSS types, we have the same cases of script types.
            case 'css': {
              if (cleanPath.startsWith('/')) {
                // Public-root absolute styles are preserved as-is
                thisChildNode = parse5utilities.setAttribute(
                  thisChildNode,
                  'href',
                  cleanPath + (search || '') + (hash || '')
                )
              } else {
                if (!firstLinkAttrs) {
                  firstLinkAttrs = Array.isArray((thisChildNode as any).attrs)
                    ? [...(thisChildNode as any).attrs]
                    : []
                }
                thisChildNode = parse5utilities.remove(thisChildNode)
                hasCssEntry = true
              }
              break
            }
            // For static assets, we have three cases:
            // 1. If the file is excluded, we replace the src or href attribute
            // with the excluded file path (absolute path).
            // 2. If the file is not excluded and is a compilation entry,
            // we replace the src or href attribute with the entryname
            // from the compilation entry.
            // 3. If the file is not excluded and is not a compilation entry,
            // we replace the src or href attribute with the resolved path
            // from the assets folder.
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
        // Create the link tag for the CSS bundle.
        if (hasCssEntry) {
          injectCssLink(htmlChildNode, feature, firstLinkAttrs, cssHrefOverride)
        }
      }

      if (htmlChildNode.nodeName === 'body') {
        bodyNode = htmlChildNode
      }
    }

    // Create the script tag for the JS bundle. We want a single JS entry
    // point for the extension even during development.
    if (hasJsEntry || compilation.options.mode !== 'production') {
      if (bundledScriptNodes.length > 0) {
        // Swap the last original tag for the bundle tag in place; drop the
        // rest. Execution order relative to inline scripts and preserved
        // (root-absolute) tags stays the author's.
        for (const scriptNode of bundledScriptNodes.slice(0, -1)) {
          parse5utilities.remove(scriptNode)
        }
        const lastScriptNode = bundledScriptNodes[bundledScriptNodes.length - 1]
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

  // If we get here, we didn't find an html node
  return ''
}

/**
 * Patches a nested HTML: preserve original script/link tags,
 * only rewrite static assets, and warn about missing public-root assets.
 */
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
          // public-root absolute paths are preserved; others are emitted or linked

          let thisChildNode: any = childNode

          switch (assetType) {
            case 'script': {
              if (cleanPath.startsWith('/')) {
                warnIfPublicRootAssetMissing(compilation, htmlEntry, cleanPath)

                // Keep as-is (but normalize URL for query/hash)
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
