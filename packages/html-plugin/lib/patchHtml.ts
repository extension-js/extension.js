import fs from 'fs'
import path from 'path'
// @ts-ignore
import utils from 'parse5-utils'
import parseHtml from './parseHtml'
import shouldExclude from '../helpers/shouldExclude'
import {
  getFilePathWithinFolder,
  getFilePathSplitByDots
} from '../helpers/getResourceName'

export default function patchHtml(
  feature: string,
  htmlEntry: string,
  exclude: string[]
) {
  const htmlFile = fs.readFileSync(htmlEntry, {encoding: 'utf8'})
  const htmlDocument = utils.parse(htmlFile)

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
          const entryExt = path.extname(filePath)
          // Do not attempt to rewrite the asset path if it's in the exclude list.
          const shouldSkipRewrite = shouldExclude(exclude, filePath)

          // TODO: After testing HMR and ensuring the custom file path
          // works, consider making features as [feature]/folder.ext
          // instead of [feature].folder.ext. This will prettify the output.
          const fileOutputpath = shouldSkipRewrite
            ? path.normalize(filePath)
            : getFilePathSplitByDots(feature, filePath)

          const assetOutputpath = shouldSkipRewrite
            ? path.normalize(filePath)
            : getFilePathWithinFolder(feature, filePath)

          switch (assetType) {
            case 'script': {
              node = utils.setAttribute(
                childNode,
                'src',
                `/${fileOutputpath.replace(entryExt, '.js')}`
              )
              break
            }
            case 'css': {
              node = utils.setAttribute(
                childNode,
                'href',
                `/${assetOutputpath.replace(entryExt, '.css')}`
              )
              break
            }
            case 'staticHref':
            case 'staticSrc': {
              node = utils.setAttribute(
                childNode,
                assetType === 'staticSrc' ? 'src' : 'href',
                `/${assetOutputpath}`
              )
              break
            }
            default:
              break
          }
        })
      }
    }

    return utils.serialize(htmlDocument)
  }
}
