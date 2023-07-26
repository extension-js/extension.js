import fs from 'fs'
import path from 'path'
// @ts-ignore
import utils from 'parse5-utils'
import parseHtml from './parseHtml'

export interface ParsedHtmlAsset {
  css: string[]
  js: string[]
  static: string[]
}

export default function getHtmlResources(htmlFilePath: string) {
  // Don't try to read the HTML file if it doesn't exist.
  // The error will be handled by EnsureManifestEntryPlugin.
  if (!fs.existsSync(htmlFilePath)) {
    return {
      css: [],
      js: [],
      static: [],
      html: htmlFilePath
    }
  }

  const htmlFile = fs.readFileSync(htmlFilePath, {encoding: 'utf8'})
  const htmlDocument = utils.parse(htmlFile)

  const headAssets: ParsedHtmlAsset = {
    css: [],
    js: [],
    static: []
  }

  const bodyAssets: ParsedHtmlAsset = {
    css: [],
    js: [],
    static: []
  }

  for (const node of htmlDocument.childNodes) {
    if (node.nodeName !== 'html') continue

    for (const childNode of node.childNodes) {
      // We don't really care whether the asset is in the head or body
      // element, as long as it's not a regular text note, we're good.
      if (childNode.nodeName === 'head') {
        parseHtml(childNode, (filePath, childNode, assetType) => {
          const fileAbsolutePath = path.join(
            path.dirname(htmlFilePath),
            filePath.startsWith('/')
              ? path.relative(path.dirname(htmlFilePath), filePath)
              : filePath
          )

          switch (assetType) {
            case 'script':
              headAssets.js.push(fileAbsolutePath)
              break
            case 'css':
              headAssets.css.push(fileAbsolutePath)
              break
            case 'staticSrc':
            case 'staticHref':
              headAssets.static.push(fileAbsolutePath)
              break
            default:
              break
          }
        })
      }

      if (childNode.nodeName === 'body') {
        parseHtml(childNode, (filePath, childNode, assetType) => {
          const fileAbsolutePath = path.join(
            path.dirname(htmlFilePath),
            filePath.startsWith('/')
              ? path.relative(path.dirname(htmlFilePath), filePath)
              : filePath
          )

          switch (assetType) {
            case 'script':
              bodyAssets.js.push(fileAbsolutePath)
              break
            case 'css':
              bodyAssets.css.push(fileAbsolutePath)
              break
            case 'staticSrc':
            case 'staticHref':
              bodyAssets.static.push(fileAbsolutePath)
              break
            default:
              break
          }
        })
      }
    }

    return {
      // Assets from HTML pages to copy to the outputFilePath path
      css: [...headAssets.css, ...bodyAssets.css],
      // Assets frorm HTML pages to use as webpack entries
      js: [...headAssets.js, ...bodyAssets.js],
      // Assets frorm HTML pages to copy to the outputFilePath path
      static: [...headAssets.static, ...bodyAssets.static],
      // The document itself
      html: htmlFilePath
    }
  }
}
