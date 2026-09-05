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
import {isDebug} from '../../lib/messaging'
import * as messages from './messages'
import {resolveJsonResource} from './resolve-json-resource'

export function trackJsonDependencies(
  compilation: Compilation,
  manifestPath: string,
  includeList: Record<string, string | string[] | undefined>
): void {
  // Tracked even when this build errored: a malformed ruleset or schema is
  // exactly the file whose fix must trigger the next rebuild.

  const jsonFields = includeList || {}
  const manifestDir = path.dirname(manifestPath)
  const projectPath =
    compilation.compiler.options.context ||
    compilation.options.context ||
    manifestDir
  let added = 0

  for (const field of Object.entries(jsonFields)) {
    const [, resource] = field

    const resourceArr: Array<string | undefined> = Array.isArray(resource)
      ? resource
      : [resource]

    for (const thisResource of resourceArr) {
      if (thisResource) {
        const {abs} = resolveJsonResource(
          thisResource,
          manifestDir,
          projectPath
        )

        // Check the live set directly: copying compilation.fileDependencies per
        // resource iteration just to call .has was a real cost.
        if (!fs.existsSync(abs)) {
          compilation.missingDependencies?.add(abs)
          continue
        }
        if (!compilation.fileDependencies.has(abs)) {
          compilation.fileDependencies.add(abs)
          added++
        }
      }
    }
  }
  if (isDebug()) {
    console.log(messages.jsonDepsTracked(added))
  }
}
