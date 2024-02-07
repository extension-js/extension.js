import fs from 'fs'
import path from 'path'
import {Compilation} from 'webpack'
// @ts-ignore
import parse5utils from 'parse5-utils'

import parseHtml from './parseHtml'
import * as file from '../helpers/utils'
import getFilePath from '../helpers/getFilePath'
import {IncludeList} from '../types'

export default function patchHtml(
  compilation: Compilation,
  feature: string,
  htmlEntry: string,
  includeList: IncludeList,
  exclude: string[]
) {
  const htmlFile = fs.readFileSync(htmlEntry, {encoding: 'utf8'})
  const htmlDocument = parse5utils.parse(htmlFile)

  let hasCssEntry = false
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
          const extname = file.getExtname(absolutePath)
          // public/ and script/ paths are excluded from the compilation.
          const isExcludedPath = file.shouldExclude(absolutePath, exclude)
          const excludedFilePath = path.join('/', path.normalize(filePath))
          // Check if the file is in the compilation entry map.
          const includeListEntry = file.isFromIncludeList(
            includeList,
            absolutePath
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
              } else if (includeListEntry) {
                const filepath = file.getIncludeEntry(
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
                node = parse5utils.setAttribute(
                  childNode,
                  assetType === 'staticSrc' ? 'src' : 'href',
                  getFilePath(filepath, extname, true)
                )
              }
              break
            }
            default:
              break
          }
        })
      }

      if (htmlChildNode.nodeName === 'head') {
        if (hasCssEntry) {
          // Create the link tag for the CSS bundle
          const linkTag = parse5utils.createNode('link')
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
          const scriptTag = parse5utils.createNode('script')
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
