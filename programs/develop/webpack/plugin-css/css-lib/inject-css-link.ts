//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as parse5utilities from 'parse5-utilities'

/**
 * Injects a `<link rel="stylesheet">` tag into the given `<head>` node
 * for the bundled CSS of an entry feature.
 *
 * @param headNode   – The parse5 `<head>` node to append to.
 * @param feature    – Entry name (e.g. `chrome_url_overrides/newtab`).
 * @param firstLinkAttrs – Attributes captured from the first user-authored
 *   `<link>` so that non-default attributes (media, integrity, …) are
 *   propagated to the injected tag.
 * @param hrefOverride – When the emitted CSS filename differs from the
 *   canonical `/<feature>.css`, pass the actual public href here.
 */
export function injectCssLink(
  headNode: any,
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
        !linkTag.attrs.find((a: any) => a.name === attr.name)
      ) {
        linkTag.attrs.push({name: attr.name, value: attr.value})
      }
    }
  }
  parse5utilities.append(headNode, linkTag)
}
