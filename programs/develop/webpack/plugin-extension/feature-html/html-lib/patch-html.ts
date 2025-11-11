import * as fs from 'fs'
import * as path from 'path'
import {WebpackError, type Compilation} from '@rspack/core'
import * as parse5utilities from 'parse5-utilities'
import {parseHtml} from './parse-html'
import {getExtname, getFilePath, cleanAssetUrl, getBaseHref} from './utils'
import {type FilepathList} from '../../../webpack-types'
import {handleStaticAsset} from './assets'
import {injectCssLink, injectJsScript} from './inject'
import * as messages from './messages'

export function patchHtml(
  compilation: Compilation,
  feature: string,
  htmlEntry: string,
  includeList: FilepathList
): string {
  const htmlFile = fs.readFileSync(htmlEntry, {encoding: 'utf8'})
  const htmlDocument = parse5utilities.parse(htmlFile)
  const baseHref = getBaseHref(htmlDocument)

  // Ensure that not only we cover files imported by the HTML file
  // but also by the JS files imported by the HTML file.
  let hasCssEntry = !!compilation.getAsset(feature + '.css')
  let hasJsEntry = false
  let firstScriptAttrs: Array<{name: string; value: string}> | undefined
  let firstLinkAttrs: Array<{name: string; value: string}> | undefined

  for (let node of htmlDocument.childNodes) {
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
                thisChildNode = parse5utilities.remove(thisChildNode)
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
        // During development this is populated by a mock CSS file
        // since we use style-loader to enable HMR for CSS files
        // and it inlines the styles into the page.
        if (hasCssEntry) injectCssLink(htmlChildNode, feature, firstLinkAttrs)
      }

      // Create the script tag for the JS bundle
      if (htmlChildNode.nodeName === 'body') {
        // We want a single JS entry point for the extension even
        // during development, so we only add the script tag if the
        // user has not already added one.
        if (hasJsEntry || compilation.options.mode !== 'production') {
          injectJsScript(htmlChildNode, feature, firstScriptAttrs)
        }
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

  for (let node of htmlDocument.childNodes) {
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
                const projectDir = path.dirname(path.dirname(htmlEntry))
                const publicCandidate = path.join(
                  projectDir,
                  'public',
                  cleanPath.slice(1)
                )

                if (!fs.existsSync(publicCandidate)) {
                  const errorMessage = messages.fileNotFound(
                    htmlEntry,
                    cleanPath
                  )

                  const warn = new WebpackError(errorMessage)
                  warn.name = 'HtmlPublicAssetMissing'
                  // @ts-expect-error file is not typed
                  warn.file = htmlEntry

                  const lines = String(warn.message).split('\n')
                  const filtered = lines.filter(
                    (line) => !line.includes(String(cleanPath))
                  )
                  warn.message = filtered.join('\n').trim()

                  compilation.warnings.push(warn)
                }

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
                const projectDir = path.dirname(path.dirname(htmlEntry))
                const publicCandidate = path.join(
                  projectDir,
                  'public',
                  cleanPath.slice(1)
                )

                if (!fs.existsSync(publicCandidate)) {
                  const errorMessage = messages.fileNotFound(
                    htmlEntry,
                    cleanPath
                  )

                  const warn = new WebpackError(errorMessage)
                  warn.name = 'HtmlPublicAssetMissing'
                  // @ts-expect-error file is not typed
                  warn.file = htmlEntry

                  const lines = String(warn.message).split('\n')
                  const filtered = lines.filter(
                    (line) => !line.includes(String(cleanPath))
                  )
                  warn.message = filtered.join('\n').trim()

                  compilation.warnings.push(warn)
                }
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
                const projectDir = path.dirname(path.dirname(htmlEntry))
                const publicCandidate = path.join(
                  projectDir,
                  'public',
                  cleanPath.slice(1)
                )

                if (!fs.existsSync(publicCandidate)) {
                  const errorMessage = messages.fileNotFound(
                    htmlEntry,
                    cleanPath
                  )
                  const warn = new WebpackError(errorMessage)
                  warn.name = 'HtmlPublicAssetMissing'
                  // @ts-expect-error file is not typed
                  warn.file = htmlEntry
                  const lines = String(warn.message).split('\n')
                  const filtered = lines.filter(
                    (line) => !line.includes(String(cleanPath))
                  )
                  warn.message = filtered.join('\n').trim()

                  compilation.warnings.push(warn)
                }
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
                  const filepath = path.posix.join('assets', posixRelative)
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
