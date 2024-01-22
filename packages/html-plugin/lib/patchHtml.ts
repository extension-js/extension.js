import fs from 'fs'
import path from 'path'
// @ts-ignore
import utils from 'parse5-utils'
import parseHtml from './parseHtml'
import shouldExclude from '../helpers/shouldExclude'
import {getFilepath} from '../helpers/getResourceName'

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
          // Do not attempt to rewrite the asset path if it's in the exclude list.
          const isPublicFolder = shouldExclude(exclude, filePath)

          const assetOutputpath = isPublicFolder
            ? path.normalize(filePath)
            : getFilepath(feature, filePath)

          switch (assetType) {
            case 'script': {
              if (isPublicFolder) {
                node = utils.setAttribute(
                  childNode,
                  'src',
                  `/${assetOutputpath}`
                )
              } else {
                node = utils.remove(childNode)
              }
              break
            }
            case 'css': {
              if (isPublicFolder) {
                node = utils.setAttribute(
                  childNode,
                  'href',
                  `/${assetOutputpath}`
                )
              } else {
                node = utils.remove(childNode)
              }
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

      // Create the link tag for the CSS bundle
      if (htmlChildNode.nodeName === 'head') {
        const linkTag = utils.createNode('link')
        linkTag.attrs = [
          {name: 'rel', value: 'stylesheet'},
          {name: 'href', value: getFilepath('.', './index.css')}
        ]

        utils.append(htmlChildNode, linkTag)
      }

      // Create the script tag for the JS bundle
      if (htmlChildNode.nodeName === 'body') {
        const scriptTag = utils.createNode('script')
        scriptTag.attrs = [{name: 'src', value: getFilepath('.', './index.js')}]

        utils.append(htmlChildNode, scriptTag)
      }
    }

    return utils.serialize(htmlDocument)
  }
}
