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

export default function getAssetsFromHtml(
  htmlFilePath: string,
  htmlContent?: string
) {
  const htmlString =
    htmlContent || fs.readFileSync(htmlFilePath, {encoding: 'utf8'})
  const htmlDocument = utils.parse(htmlString)

  const assets: ParsedHtmlAsset = {
    css: [],
    js: [],
    static: []
  }

  const getAbsolutePath = (htmlFilePath: string, filePath: string) => {
    return path.join(
      path.dirname(htmlFilePath),
      filePath.startsWith('/')
        ? path.relative(path.dirname(htmlFilePath), filePath)
        : filePath
    )
  }

  for (const node of htmlDocument.childNodes) {
    if (node.nodeName !== 'html') continue

    for (const childNode of node.childNodes) {
      // We don't really care whether the asset is in the head or body
      // element, as long as it's not a regular text note, we're good.
      if (childNode.nodeName === 'head' || childNode.nodeName === 'body') {
        parseHtml(childNode, ({filePath, assetType}) => {
          const fileAbsolutePath = getAbsolutePath(htmlFilePath, filePath)

          switch (assetType) {
            case 'script':
              assets.js.push(fileAbsolutePath)
              break
            case 'css':
              assets.css.push(fileAbsolutePath)
              break
            case 'staticSrc':
            case 'staticHref':
              assets.static.push(fileAbsolutePath)
              break
            default:
              break
          }
        })
      }
    }

    return {
      // Assets from HTML pages to copy to the outputFilePath path
      css: assets.css,
      // Assets frorm HTML pages to use as webpack entries
      js: assets.js,
      // Assets frorm HTML pages to copy to the outputFilePath path
      static: assets.static
    }
  }
}
