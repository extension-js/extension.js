import fs from 'fs'
import path from 'path'
import {Compilation} from 'webpack'
// @ts-ignore
import parse5utils from 'parse5-utils'

import parseHtml from './parseHtml'
import * as fileUtils from '../helpers/utils'

export default function patchHtml(
  compilation: Compilation,
  htmlEntry: string,
  exclude: string[]
) {
  const htmlFile = fs.readFileSync(htmlEntry, {encoding: 'utf8'})
  const htmlDocument = parse5utils.parse(htmlFile)
  const context = compilation.options.context || ''
  const manifestPath = path.resolve(context, 'manifest.json')

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
          const absolutePath = path.resolve(context, filePath)
          // Do not attempt to rewrite the asset path if it's in the exclude list.
          const isExcludedPath = fileUtils.shouldExclude(absolutePath, exclude)
          const excludedPath = fileUtils.getResolvedPath(
            context,
            filePath,
            'public'
          )
          const isItCompilationEntry = fileUtils.isCompilationEntry(
            compilation,
            filePath
          )
          const compilationEntry = fileUtils.getCompilationEntryName(
            compilation,
            filePath
          )

          switch (assetType) {
            case 'script': {
              if (isExcludedPath) {
                node = parse5utils.setAttribute(childNode, 'src', excludedPath)
              } else {
                node = parse5utils.remove(childNode)
                hasJsEntry = true
              }
              break
            }
            case 'css': {
              if (isExcludedPath) {
                node = parse5utils.setAttribute(childNode, 'href', excludedPath)
              } else {
                node = parse5utils.remove(childNode)
                hasCssEntry = true
              }
              break
            }
            case 'staticHref':
            case 'staticSrc': {
              // Handle import of static assets that also happen
              // to be in the pages folder. Mainly an iframe.
              if (isExcludedPath) {
                node = parse5utils.setAttribute(
                  childNode,
                  assetType === 'staticSrc' ? 'src' : 'href',
                  excludedPath
                )
              } else if (isItCompilationEntry) {
                node = parse5utils.setAttribute(
                  childNode,
                  assetType === 'staticSrc' ? 'src' : 'href',
                  fileUtils.getResolvedPath(
                    manifestPath,
                    filePath,
                    compilationEntry
                  )
                )
              } else {
                node = parse5utils.setAttribute(
                  childNode,
                  assetType === 'staticSrc' ? 'src' : 'href',
                  fileUtils.getResolvedPath(manifestPath, filePath, 'assets')
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
            {name: 'href', value: './index.css'}
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
          scriptTag.attrs = [{name: 'src', value: './index.js'}]

          parse5utils.append(htmlChildNode, scriptTag)
        }
      }
    }

    return parse5utils.serialize(htmlDocument)
  }
}
