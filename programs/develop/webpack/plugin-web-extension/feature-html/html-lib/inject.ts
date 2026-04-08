// ██╗  ██╗████████╗███╗   ███╗██╗
// ██║  ██║╚══██╔══╝████╗ ████║██║
// ███████║   ██║   ██╔████╔██║██║
// ██╔══██║   ██║   ██║╚██╔╝██║██║
// ██║  ██║   ██║   ██║ ╚═╝ ██║███████╗
// ╚═╝  ╚═╝   ╚═╝   ╚═╝     ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import * as parse5utilities from 'parse5-utilities'
import {getFilePath} from './utils'

// CSS link injection has been moved to plugin-css/css-lib/inject-css-link.ts

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
