import fs from 'fs'
import path from 'path'
// @ts-ignore
import utils from 'parse5-utils'
import parseHtml from './parseHtml'
import shouldExclude from '../helpers/shouldExclude'
import {getFilepath} from '../helpers/getResourceName'
import {Compiler} from 'webpack'
import {getPagePath, isPage} from '../helpers/pageUtils'
import {getPublicPath} from '../helpers/publicUtils'
import {
  getManifestHtmlEntry,
  isManifestHtmlEntry
} from '../helpers/htmlEntryUtils'

export default function patchHtml(
  compiler: Compiler,
  feature: string,
  htmlEntry: string,
  exclude: string[]
) {
  const htmlFile = fs.readFileSync(htmlEntry, {encoding: 'utf8'})
  const htmlDocument = utils.parse(htmlFile)

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
          // Do not attempt to rewrite the asset path if it's in the exclude list.
          const isPublicFolder = shouldExclude(exclude, filePath)

          const assetOutputpath = isPublicFolder
            ? getPublicPath(filePath)
            : '/' + getFilepath(feature, filePath)

          switch (assetType) {
            case 'script': {
              if (isPublicFolder) {
                node = utils.setAttribute(
                  childNode,
                  'src',
                  `${assetOutputpath}`
                )
              } else {
                node = utils.remove(childNode)
                hasJsEntry = true
              }
              break
            }
            case 'css': {
              if (isPublicFolder) {
                node = utils.setAttribute(
                  childNode,
                  'href',
                  `${assetOutputpath}`
                )
              } else {
                node = utils.remove(childNode)
                hasCssEntry = true
              }
              break
            }
            case 'staticHref':
            case 'staticSrc': {
              const manifestPath = path.resolve(
                compiler.options.context || '',
                'manifest.json'
              )
              const filePathAbsolute = path.resolve(
                path.dirname(htmlEntry),
                filePath
              )
              const isFilePathPagesFolder = isPage(
                manifestPath,
                filePathAbsolute
              )
              const isFilePathManifestEntry = isManifestHtmlEntry(
                manifestPath,
                filePathAbsolute
              )
              const pagePath = getPagePath(manifestPath, filePathAbsolute)

              // Handle import of static assets that also happen
              // to be in the pages folder. Mainly an iframe.
              if (isFilePathPagesFolder) {
                node = utils.setAttribute(
                  childNode,
                  assetType === 'staticSrc' ? 'src' : 'href',
                  `${pagePath}`
                )
              } else if (isFilePathManifestEntry) {
                const manifestEntry = getManifestHtmlEntry(
                  manifestPath,
                  filePathAbsolute
                )
                node = utils.setAttribute(
                  childNode,
                  assetType === 'staticSrc' ? 'src' : 'href',
                  `${manifestEntry}`
                )
              } else {
                node = utils.setAttribute(
                  childNode,
                  assetType === 'staticSrc' ? 'src' : 'href',
                  `${assetOutputpath}`
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
          const linkTag = utils.createNode('link')
          linkTag.attrs = [
            {name: 'rel', value: 'stylesheet'},
            {name: 'href', value: getFilepath('.', './index.css')}
          ]

          utils.append(htmlChildNode, linkTag)
        }
      }

      // Create the script tag for the JS bundle
      if (htmlChildNode.nodeName === 'body') {
        // We want a single JS entry point for the extension even
        // during development, so we only add the script tag if the
        // user has not already added one.
        if (hasJsEntry || compiler.options.mode !== 'production') {
          const scriptTag = utils.createNode('script')
          scriptTag.attrs = [
            {name: 'src', value: getFilepath('.', './index.js')}
          ]

          utils.append(htmlChildNode, scriptTag)
        }
      }
    }

    return utils.serialize(htmlDocument)
  }
}
