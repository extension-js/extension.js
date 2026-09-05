//      ██╗███████╗      ███████╗██████╗  █████╗ ███╗   ███╗███████╗██╗    ██╗ ██████╗ ██████╗ ██╗  ██╗███████╗
//      ██║██╔════╝      ██╔════╝██╔══██╗██╔══██╗████╗ ████║██╔════╝██║    ██║██╔═══██╗██╔══██╗██║ ██╔╝██╔════╝
//      ██║███████╗█████╗█████╗  ██████╔╝███████║██╔████╔██║█████╗  ██║ █╗ ██║██║   ██║██████╔╝█████╔╝ ███████╗
// ██   ██║╚════██║╚════╝██╔══╝  ██╔══██╗██╔══██║██║╚██╔╝██║██╔══╝  ██║███╗██║██║   ██║██╔══██╗██╔═██╗ ╚════██║
// ╚█████╔╝███████║      ██║     ██║  ██║██║  ██║██║ ╚═╝ ██║███████╗╚███╔███╔╝╚██████╔╝██║  ██║██║  ██╗███████║
//  ╚════╝ ╚══════╝      ╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝╚══════╝ ╚══╝╚══╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {createRequire} from 'node:module'
import * as path from 'node:path'
import {resolveDevelopDistFile} from '../../lib/develop-context'
import {isDebug, prefix} from '../../lib/messaging'
import type {JsFramework} from '../../types'
import {hasDependency} from '../frameworks-lib/integrations'
import * as messages from '../js-frameworks-lib/messages'

let userMessageDelivered = false

export function isUsingSolid(projectPath: string) {
  if (hasDependency(projectPath, 'solid-js')) {
    if (!userMessageDelivered) {
      if (isDebug()) {
        console.log(
          `${prefix('debug')} ${messages.isUsingIntegration('Solid')}`
        )
      }

      userMessageDelivered = true
    }
    return true
  }

  return false
}

// solid-js ships JSX types only; its runtime JSX path is the hyperscript
// entry, so the automatic runtime is routed through a small adapter over it.
export async function maybeUseSolid(
  projectPath: string
): Promise<JsFramework | undefined> {
  if (!isUsingSolid(projectPath)) return undefined

  const requireFromProject = createRequire(
    path.join(projectPath, 'package.json')
  )
  const resolveFromProject = (id: string) => {
    try {
      return requireFromProject.resolve(id)
    } catch {
      return undefined
    }
  }

  const adapter = resolveDevelopDistFile('solid-jsx-runtime')
  const hyperscript = resolveFromProject('solid-js/h')

  const alias: Record<string, string> = {
    'solid-js/jsx-runtime$': adapter,
    'solid-js/jsx-dev-runtime$': adapter
  }
  if (hyperscript) alias['solid-js/h$'] = hyperscript

  return {
    plugins: [],
    loaders: undefined,
    alias
  }
}
