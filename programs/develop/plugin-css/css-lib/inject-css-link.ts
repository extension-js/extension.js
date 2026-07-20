//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as parse5utilities from 'parse5-utilities'

// Injects a <link rel="stylesheet"> into the given <head> for the bundled CSS
// of an entry feature; hrefOverride covers non-canonical emitted names.
export function injectCssLink(
  headNode: Parameters<typeof parse5utilities.append>[0],
  feature: string,
  firstLinkAttrs?: Array<{name: string; value: string}>,
  hrefOverride?: string
) {
  const linkTag = parse5utilities.createNode('link')
  linkTag.attrs = [
    {name: 'rel', value: 'stylesheet'},
    {name: 'href', value: hrefOverride || `/${feature}.css`}
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
        !linkTag.attrs.find((a) => a.name === attr.name)
      ) {
        linkTag.attrs.push({name: attr.name, value: attr.value})
      }
    }
  }
  parse5utilities.append(headNode, linkTag)
}
