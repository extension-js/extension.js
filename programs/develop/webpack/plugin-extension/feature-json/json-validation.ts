//      ██╗███████╗ ██████╗ ███╗   ██╗
//      ██║██╔════╝██╔═══██╗████╗  ██║
//      ██║███████╗██║   ██║██╔██╗ ██║
// ██   ██║╚════██║██║   ██║██║╚██╗██║
// ╚█████╔╝███████║╚██████╔╝██║ ╚████║
//  ╚════╝ ╚══════╝ ╚═════╝ ╚═╝  ╚═══╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import {Compilation, WebpackError} from '@rspack/core'
import * as messages from './messages'

export function isCriticalJsonFeature(feature: string): boolean {
  return (
    feature.startsWith('declarative_net_request') ||
    feature === 'storage.managed_schema'
  )
}

export function validateJsonAsset(
  compilation: Compilation,
  feature: string,
  filePath: string,
  buf: Buffer
): boolean {
  let parsed: unknown
  try {
    parsed = JSON.parse(buf.toString('utf-8'))
  } catch (e: any) {
    const err = new WebpackError(
      messages.invalidJsonSyntax(feature, filePath, String(e?.message || e))
    )
    ;(err as any).file = filePath
    err.name = 'JSONInvalidSyntax'
    compilation.errors.push(err)
    return false
  }

  if (feature.startsWith('declarative_net_request')) {
    if (!Array.isArray(parsed)) {
      const err = new WebpackError(
        messages.invalidRulesetStructure(feature, filePath)
      )
      ;(err as any).file = filePath
      err.name = 'DNRInvalidRuleset'

      compilation.errors.push(err)

      return false
    }
  } else if (feature === 'storage.managed_schema') {
    if (
      parsed === null ||
      Array.isArray(parsed) ||
      typeof parsed !== 'object'
    ) {
      const err = new WebpackError(
        messages.invalidManagedSchemaStructure(feature, filePath)
      )
      ;(err as any).file = filePath
      err.name = 'ManagedSchemaInvalid'

      compilation.errors.push(err)

      return false
    }
  }

  return true
}
