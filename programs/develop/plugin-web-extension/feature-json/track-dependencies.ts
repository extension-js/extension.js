//      ██╗███████╗ ██████╗ ███╗   ██╗
//      ██║██╔════╝██╔═══██╗████╗  ██║
//      ██║███████╗██║   ██║██╔██╗ ██║
// ██   ██║╚════██║██║   ██║██║╚██╗██║
// ╚█████╔╝███████║╚██████╔╝██║ ╚████║
//  ╚════╝ ╚══════╝ ╚═════╝ ╚═╝  ╚═══╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import type {Compilation} from '@rspack/core'
import * as messages from './messages'

export function trackJsonDependencies(
  compilation: Compilation,
  manifestPath: string,
  includeList: Record<string, string | string[] | undefined>
): void {
  if (compilation.errors?.length) return

  const jsonFields = includeList || {}
  const manifestDir = path.dirname(manifestPath)
  let added = 0

  for (const field of Object.entries(jsonFields)) {
    const [, resource] = field

    const resourceArr: Array<string | undefined> = Array.isArray(resource)
      ? resource
      : [resource]

    for (const thisResource of resourceArr) {
      if (thisResource) {
        const abs = path.isAbsolute(thisResource)
          ? thisResource
          : path.join(manifestDir, thisResource)

        // Check the live set directly. The previous `new Set(compilation
        // .fileDependencies)` copied the entire dependency set on every
        // resource iteration just to call `.has` on the copy
        if (fs.existsSync(abs) && !compilation.fileDependencies.has(abs)) {
          compilation.fileDependencies.add(abs)
          added++
        }
      }
    }
  }
  if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
    console.log(messages.jsonDepsTracked(added))
  }
}
