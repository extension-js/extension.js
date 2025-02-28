import fs from 'fs'
import path from 'path'
import {type Compilation} from 'webpack'
// @ts-ignore
import parse5utils from 'parse5-utils'
import {parseHtml} from './parse-html'
import {getExtname, getFilePath, getHtmlPageDeclaredAssetPath} from './utils'
import {type FilepathList} from '../../../webpack-types'
import * as utils from '../../../lib/utils'

export function patchHtml(
  compilation: Compilation,
  feature: string,
  htmlEntry: string,
  includeList: FilepathList,
  excludeList: FilepathList
) {
  const htmlFile = fs.readFileSync(htmlEntry, {encoding: 'utf8'})
  const htmlDocument = parse5utils.parse(htmlFile)

  // Ensure that not only we cover files imported by the HTML file
  // but also by the JS files imported by the HTML file.
  let hasCssEntry = !!compilation.getAsset(feature + '.css')
  let hasJsEntry = false

  for (let node of htmlDocument.childNodes) {
    if (node.nodeName !== 'html') continue

    for (const htmlChildNode of node.childNodes) {
      // We don't really care whether the asset is in the head or body
      // element, as long as it's not a regular text note, we're good.
      if (
        htmlChildNode.nodeName === 'head' ||
        htmlChildNode.nodeName === 'body'
      ) {
        parseHtml(htmlChildNode, ({filePath, childNode, assetType}) => {
          const htmlDir = path.dirname(htmlEntry)
          const absolutePath = path.resolve(htmlDir, filePath)
          const extname = getExtname(absolutePath)
          // public/ and script/ paths are excluded from the compilation.
          const isExcludedPath = utils.shouldExclude(
            path.resolve(htmlDir, filePath),
            excludeList
          )

          const excludedFilePath = path.join('/', path.normalize(filePath))
          // Check if the file is in the compilation entry map.
          const isFilepathListEntry = utils.isFromFilepathList(
            absolutePath,
            includeList
          )

          switch (assetType) {
            // For script types, we have two cases:
            // 1. If the file is excluded, we replace the src attribute
            // with the excluded file path (absolute path).
            // 2. If the file is not excluded, we remove the script tag
            // from the HTML file and set the JS bundle index since we compile
            // all JS files into a single bundle.
            case 'script': {
              if (isExcludedPath) {
                node = parse5utils.setAttribute(
                  childNode,
                  'src',
                  excludedFilePath
                )
              } else {
                node = parse5utils.remove(childNode)
                hasJsEntry = true
              }
              break
            } // For CSS types, we have the same cases of script types.
            case 'css': {
              if (isExcludedPath) {
                node = parse5utils.setAttribute(
                  childNode,
                  'href',
                  excludedFilePath
                )
              } else {
                node = parse5utils.remove(childNode)
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
              // Path is excluded. Resolve to absolute path.
              if (isExcludedPath) {
                node = parse5utils.setAttribute(
                  childNode,
                  assetType === 'staticSrc' ? 'src' : 'href',
                  excludedFilePath
                )
                // Path is in the include list. Resolve to entry name.
              } else if (isFilepathListEntry) {
                const filepath = getHtmlPageDeclaredAssetPath(
                  includeList,
                  absolutePath,
                  extname
                )
                node = parse5utils.setAttribute(
                  childNode,
                  assetType === 'staticSrc' ? 'src' : 'href',
                  filepath
                )
                // Path is not in the compilation entry map. Resolve to assets folder.
              } else {
                const filepath = path.join(
                  'assets',
                  path.basename(absolutePath, extname)
                )
                // There will be cases where users can add
                // a # to a link href, in which case we would try to parse.
                // This ensures we only parse the file path if its valid.
                if (fs.existsSync(absolutePath)) {
                  node = parse5utils.setAttribute(
                    childNode,
                    assetType === 'staticSrc' ? 'src' : 'href',
                    getFilePath(filepath, '', true)
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

      if (htmlChildNode.nodeName === 'head') {
        // Create the link tag for the CSS bundle.
        // During development this is populated by a mock CSS file
        // since we use style-loader to enable HMR for CSS files
        // and it inlines the styles into the page.
        if (hasCssEntry) {
          const linkTag: {attrs: {name: string; value: string}[]} =
            parse5utils.createNode('link')
          linkTag.attrs = [
            {name: 'rel', value: 'stylesheet'},
            {name: 'href', value: getFilePath(feature, '.css', true)}
          ]

          parse5utils.append(htmlChildNode, linkTag)
        }
      }

      // Create the script tag for the JS bundle
      if (htmlChildNode.nodeName === 'body') {
        // We want a single JS entry point for the extension even
        // during development, so we only add the script tag if the
        // user has not already added one.
        if (hasJsEntry || compilation.options.mode !== 'production') {
          const scriptTag: {attrs: {name: string; value: string}[]} =
            parse5utils.createNode('script')
          scriptTag.attrs = [
            {name: 'src', value: getFilePath(feature, '.js', true)}
          ]

          parse5utils.append(htmlChildNode, scriptTag)
        }
      }
    }

    return parse5utils.serialize(htmlDocument)
  }
}
