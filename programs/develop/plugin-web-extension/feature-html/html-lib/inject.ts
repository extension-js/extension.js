// ██╗  ██╗████████╗███╗   ███╗██╗
// ██║  ██║╚══██╔══╝████╗ ████║██║
// ███████║   ██║   ██╔████╔██║██║
// ██╔══██║   ██║   ██║╚██╔╝██║██║
// ██║  ██║   ██║   ██║ ╚═╝ ██║███████╗
// ╚═╝  ╚═╝   ╚═╝   ╚═╝     ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as parse5utilities from 'parse5-utilities'
import {getFilePath} from './utils'

const PROPAGATED_SCRIPT_ATTRS = new Set(['type', 'defer', 'async'])

// The attributes the author put on the bundled tag that must survive on
// every emitted tag: a module page stays a module page on each sibling.
export function scriptTagAttrs(
  src: string,
  firstScriptAttrs?: Array<{name: string; value: string}>
): Array<{name: string; value: string}> {
  const attrs = [{name: 'src', value: src}]
  for (const attr of firstScriptAttrs || []) {
    if (
      PROPAGATED_SCRIPT_ATTRS.has(attr.name) &&
      !attrs.find((a) => a.name === attr.name)
    ) {
      attrs.push({name: attr.name, value: attr.value})
    }
  }
  return attrs
}

export function createScriptTag(
  src: string,
  firstScriptAttrs?: Array<{name: string; value: string}>
): ReturnType<typeof parse5utilities.createNode> {
  const scriptTag = parse5utilities.createNode('script')
  scriptTag.attrs = scriptTagAttrs(src, firstScriptAttrs)
  return scriptTag
}

// Sibling chunks first, the entry last: the entry's runtime boots the
// modules the siblings registered, the same order a web app's HTML uses.
export function injectJsScript(
  bodyNode: Parameters<typeof parse5utilities.append>[0],
  feature: string,
  firstScriptAttrs?: Array<{name: string; value: string}>,
  siblingScripts: string[] = []
) {
  for (const src of siblingScripts) {
    parse5utilities.append(bodyNode, createScriptTag(src, firstScriptAttrs))
  }
  parse5utilities.append(
    bodyNode,
    createScriptTag(getFilePath(feature, '.js', true), firstScriptAttrs)
  )
}
