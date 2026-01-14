// ██╗  ██╗████████╗███╗   ███╗██╗
// ██║  ██║╚══██╔══╝████╗ ████║██║
// ███████║   ██║   ██╔████╔██║██║
// ██╔══██║   ██║   ██║╚██╔╝██║██║
// ██║  ██║   ██║   ██║ ╚═╝ ██║███████╗
// ╚═╝  ╚═╝   ╚═╝   ╚═╝     ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import * as parse5utilities from 'parse5-utilities'
import {getFilePath} from './utils'

export function injectCssLink(
  headNode: any,
  feature: string,
  firstLinkAttrs?: Array<{name: string; value: string}>
) {
  const linkTag = parse5utilities.createNode('link')
  linkTag.attrs = [
    {name: 'rel', value: 'stylesheet'},
    {name: 'href', value: getFilePath(feature, '.css', true)}
  ]
  const propagateLinkAttrs = new Set([
    'media',
    'crossorigin',
    'integrity',
    'referrerpolicy',
    'type',
    'disabled'
  ])
  if (firstLinkAttrs) {
    for (const attr of firstLinkAttrs) {
      if (
        propagateLinkAttrs.has(attr.name) &&
        !linkTag.attrs.find((a: any) => a.name === attr.name)
      ) {
        linkTag.attrs.push({name: attr.name, value: attr.value})
      }
    }
  }
  parse5utilities.append(headNode, linkTag)
}

export function injectJsScript(
  bodyNode: any,
  feature: string,
  firstScriptAttrs?: Array<{name: string; value: string}>
) {
  const scriptTag = parse5utilities.createNode('script')
  scriptTag.attrs = [{name: 'src', value: getFilePath(feature, '.js', true)}]
  const propagateScriptAttrs = new Set(['type', 'defer', 'async'])
  if (firstScriptAttrs) {
    for (const attr of firstScriptAttrs) {
      if (
        propagateScriptAttrs.has(attr.name) &&
        !scriptTag.attrs.find((a: any) => a.name === attr.name)
      ) {
        scriptTag.attrs.push({name: attr.name, value: attr.value})
      }
    }
  }
  parse5utilities.append(bodyNode, scriptTag)
}
