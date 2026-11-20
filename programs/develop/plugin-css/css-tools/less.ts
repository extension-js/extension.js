//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {debugLine, isDebug, prefix} from '../../lib/messaging'
import {ensureOptionalContractPackageResolved} from '../../lib/optional-deps-resolver'
import {hasProjectDependency} from '../../lib/project-manifest'
import * as messages from '../css-lib/messages'

let userMessageDelivered = false

export function isUsingLess(projectPath: string): boolean {
  if (hasProjectDependency(projectPath, 'less')) {
    if (!userMessageDelivered) {
      if (isDebug()) {
        debugLine(`${prefix('debug')} ${messages.isUsingIntegration('LESS')}`)
      }

      userMessageDelivered = true
    }

    return true
  }

  return false
}

// Resolve (and install if missing) the less-loader contract; the actual loader
// rules are emitted by the content-script/HTML CSS loaders.
export async function maybeUseLess(projectPath: string): Promise<void> {
  if (!isUsingLess(projectPath)) return

  await ensureOptionalContractPackageResolved({
    contractId: 'less',
    projectPath,
    dependencyId: 'less-loader'
  })
}
