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

// The fields package spells the feature storage/managed_schema; the dotted
// form is kept for callers that still use it.
export function isManagedSchemaFeature(feature: string): boolean {
  return (
    feature === 'storage/managed_schema' || feature === 'storage.managed_schema'
  )
}

export function isCriticalJsonFeature(feature: string): boolean {
  return (
    feature.startsWith('declarative_net_request') ||
    isManagedSchemaFeature(feature)
  )
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Only shapes Chrome itself refuses at load fail the build: a wider net here
// has produced false-positive refusals before, so softer issues only warn.
function getDnrRuleRejection(rule: unknown): string | undefined {
  if (!isPlainObject(rule)) {
    return 'the rule is not an object'
  }

  const id = rule.id
  if (typeof id !== 'number' || !Number.isInteger(id) || id < 1) {
    return 'the rule id is not a positive integer'
  }

  const action = rule.action
  if (!isPlainObject(action)) {
    return 'the rule has no action object'
  }

  if (typeof action.type !== 'string' || action.type.length === 0) {
    return 'the rule action has no type'
  }

  if (!isPlainObject(rule.condition)) {
    return 'the rule has no condition object'
  }

  return undefined
}

function getDnrRuleSoftIssue(
  rule: Record<string, unknown>
): string | undefined {
  const priority = rule.priority
  if (
    priority !== undefined &&
    (typeof priority !== 'number' ||
      !Number.isInteger(priority) ||
      priority < 1)
  ) {
    return 'the rule priority is not a positive integer'
  }

  return undefined
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

    for (let index = 0; index < parsed.length; index++) {
      const rejection = getDnrRuleRejection(parsed[index])

      if (rejection) {
        const err = new WebpackError(
          messages.invalidRulesetRule(feature, filePath, index, rejection)
        )
        ;(err as Error & {file?: string}).file = filePath
        err.name = 'DNRInvalidRule'

        compilation.errors.push(err)

        return false
      }

      const softIssue = getDnrRuleSoftIssue(
        parsed[index] as Record<string, unknown>
      )

      if (softIssue) {
        const warn = new WebpackError(
          messages.rulesetRuleShapeIssue(feature, filePath, index, softIssue)
        )
        ;(warn as Error & {file?: string}).file = filePath
        warn.name = 'DNRRuleShapeIssue'

        compilation.warnings.push(warn)
      }
    }
  } else if (isManagedSchemaFeature(feature)) {
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
