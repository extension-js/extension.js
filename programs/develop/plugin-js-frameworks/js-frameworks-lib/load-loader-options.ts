//      ██╗███████╗      ███████╗██████╗  █████╗ ███╗   ███╗███████╗██╗    ██╗ ██████╗ ██████╗ ██╗  ██╗███████╗
//      ██║██╔════╝      ██╔════╝██╔══██╗██╔══██╗████╗ ████║██╔════╝██║    ██║██╔═══██╗██╔══██╗██║ ██╔╝██╔════╝
//      ██║███████╗█████╗█████╗  ██████╔╝███████║██╔████╔██║█████╗  ██║ █╗ ██║██║   ██║██████╔╝█████╔╝ ███████╗
// ██   ██║╚════██║╚════╝██╔══╝  ██╔══██╗██╔══██║██║╚██╔╝██║██╔══╝  ██║███╗██║██║   ██║██╔══██╗██╔═██╗ ╚════██║
// ╚█████╔╝███████║      ██║     ██║  ██║██║  ██║██║ ╚═╝ ██║███████╗╚███╔███╔╝╚██████╔╝██║  ██║██║  ██╗███████║
//  ╚════╝ ╚══════╝      ╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝╚══════╝ ╚══╝╚══╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {pathToFileURL} from 'node:url'
import {isDebug} from '../../lib/messaging'
import type {AnyModule} from '../../lib/optional-deps-resolver'
import * as messages from './messages'

let userMessageDelivered = false

export function resolveLoaderConfigPath(
  projectPath: string,
  framework: 'vue' | 'svelte'
) {
  const candidates = [
    path.join(projectPath, `${framework}.loader.ts`),
    path.join(projectPath, `${framework}.loader.mts`),
    path.join(projectPath, `${framework}.loader.js`),
    path.join(projectPath, `${framework}.loader.mjs`)
  ]

  return candidates.find((p) => fs.existsSync(p)) || null
}

export async function loadLoaderOptions(
  projectPath: string,
  framework: 'vue' | 'svelte'
): Promise<AnyModule> {
  const configPath = resolveLoaderConfigPath(projectPath, framework)

  if (configPath) {
    if (!userMessageDelivered && isDebug()) {
      const display = path.basename(configPath)
      console.log(messages.isUsingCustomLoader(display))
      userMessageDelivered = true
    }

    try {
      const module = await import(pathToFileURL(configPath).href)
      return module.default || module
    } catch (err: unknown) {
      const error = err as Error
      console.error(
        `Error loading ${framework} loader options: ${error.message}`
      )
      throw err
    }
  }

  return null
}
