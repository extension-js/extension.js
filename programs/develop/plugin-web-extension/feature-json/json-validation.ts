//      ██╗███████╗ ██████╗ ███╗   ██╗
//      ██║██╔════╝██╔═══██╗████╗  ██║
//      ██║███████╗██║   ██║██╔██╗ ██║
// ██   ██║╚════██║██║   ██║██║╚██╗██║
// ╚█████╔╝███████║╚██████╔╝██║ ╚████║
//  ╚════╝ ╚══════╝ ╚═════╝ ╚═╝  ╚═══╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {type Compilation, WebpackError} from '@rspack/core'
import {stripBom} from '../../lib/parse-json-safe'
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
    parsed = JSON.parse(stripBom(buf.toString('utf-8')))
  } catch (e) {
    const err = new WebpackError(
      messages.invalidJsonSyntax(
        feature,
        filePath,
        String((e as Error | undefined)?.message || e)
      )
    )
    ;(err as Error & {file?: string}).file = filePath
    err.name = 'JSONInvalidSyntax'
    compilation.errors.push(err)
    return false
  }

  if (feature.startsWith('declarative_net_request')) {
    if (!Array.isArray(parsed)) {
      const err = new WebpackError(
        messages.invalidRulesetStructure(feature, filePath)
      )
      ;(err as Error & {file?: string}).file = filePath
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
      ;(err as Error & {file?: string}).file = filePath
      err.name = 'ManagedSchemaInvalid'

      compilation.errors.push(err)

      return false
    }
  }

  return true
}
