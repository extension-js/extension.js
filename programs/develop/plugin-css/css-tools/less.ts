//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import colors from 'pintor'
import {hasDependency} from '../../lib/has-dependency'
import {ensureOptionalContractPackageResolved} from '../../lib/optional-deps-resolver'
import * as messages from '../css-lib/messages'

let userMessageDelivered = false

export function isUsingLess(projectPath: string): boolean {
  if (hasDependency(projectPath, 'less')) {
    if (!userMessageDelivered) {
      if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
        console.log(
          `${colors.brightMagenta('⏵⏵⏵ Author says')} ${messages.isUsingIntegration('LESS')}`
        )
      }

      userMessageDelivered = true
    }
    return true
  }

  return false
}

/**
 * Resolve (and install if missing) the less-loader contract. The actual loader
 * rules are emitted by the content-script/HTML CSS loaders. This only ensures
 * the optional dependency is present before that chain runs.
 */
export async function maybeUseLess(projectPath: string): Promise<void> {
  if (!isUsingLess(projectPath)) return

  await ensureOptionalContractPackageResolved({
    contractId: 'less',
    projectPath,
    dependencyId: 'less-loader'
  })
}
