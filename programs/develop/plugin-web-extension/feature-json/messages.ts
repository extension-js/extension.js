//      ██╗███████╗ ██████╗ ███╗   ██╗
//      ██║██╔════╝██╔═══██╗████╗  ██║
//      ██║███████╗██║   ██║██╔██╗ ██║
// ██   ██║╚════██║██║   ██║██║╚██╗██║
// ╚█████╔╝███████║╚██████╔╝██║ ╚████║
//  ╚════╝ ╚══════╝ ╚═════╝ ╚═╝  ╚═══╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import colors from 'pintor'
import {prefix} from '../../lib/messaging'

export function entryNotFoundMessageOnly(
  manifestField: string,
  absPath?: string
) {
  const lines: string[] = []
  lines.push(`Can't find the file listed in ${colors.blue(manifestField)}.`)
  if (absPath) {
    lines.push(`${colors.gray('NOT FOUND')} ${colors.underline(absPath)}`)
  }
  lines.push(
    `Update the ${colors.blue(manifestField)} field in your ${colors.blue('manifest.json')} file.`
  )
  return lines.join('\n')
}

export function jsonMissingFile(
  manifestField: string,
  filePath: string,
  opts?: {publicRootHint?: boolean; fatal?: boolean}
) {
  const lines: string[] = []

  lines.push(
    `Can't find the JSON file listed in ${colors.blue(manifestField)}.`
  )
  lines.push(`${colors.gray('NOT FOUND')} ${colors.underline(filePath)}`)
  // Only the critical features (rulesets, managed schemas) stop the build, so
  // the promise has to track the severity that ships with it.
  lines.push(
    opts?.fatal
      ? `Browsers can reject or crash the extension when required JSON files like rulesets are missing.\nThe build stops here.`
      : `Browsers can reject or misread the extension when this file is missing.\nThe build continues.`
  )

  if (opts?.publicRootHint) {
    lines.push(
      `Paths starting with '/' are resolved from the extension output root (served from ${colors.blue('public/')}), not your source directory.`
    )
  }
  lines.push(
    `Update the JSON path in your ${colors.blue('manifest.json')} to a file that ships with the extension.`
  )

  return lines.join('\n')
}

export function invalidJsonSyntax(
  manifestField: string,
  file: string,
  cause: string
) {
  return [
    `Can't parse the JSON file listed in ${colors.blue(manifestField)}.`,
    `${colors.gray('PATH')} ${colors.underline(file)}`,
    `${colors.gray('REASON')} ${colors.underline(cause)}`,
    `Fix the JSON syntax, then rebuild.`
  ].join('\n')
}

export function invalidRulesetStructure(manifestField: string, file: string) {
  return [
    `The Declarative Net Request ruleset listed in ${colors.blue(manifestField)} isn't a rule array.`,
    `${colors.gray('PATH')} ${colors.underline(file)}`,
    `${colors.gray('EXPECTED')} ${colors.underline('a top-level JSON array of rule objects')}`,
    `Update the file to contain an array of rules.`
  ].join('\n')
}

export function invalidRulesetRule(
  manifestField: string,
  file: string,
  ruleIndex: number,
  reason: string
) {
  return [
    `The Declarative Net Request ruleset listed in ${colors.blue(manifestField)} has a rule Chrome rejects at load.`,
    `${colors.gray('PATH')} ${colors.underline(file)}`,
    `${colors.gray('RULE')} ${colors.underline(`index ${ruleIndex}`)}`,
    `${colors.gray('REASON')} ${colors.underline(reason)}`,
    `Give every rule an integer id of 1 or more, an action with a type, and a condition object.`
  ].join('\n')
}

export function rulesetRuleShapeIssue(
  manifestField: string,
  file: string,
  ruleIndex: number,
  reason: string
) {
  return [
    `A rule in the Declarative Net Request ruleset listed in ${colors.blue(manifestField)} may not behave as intended.`,
    `${colors.gray('PATH')} ${colors.underline(file)}`,
    `${colors.gray('RULE')} ${colors.underline(`index ${ruleIndex}`)}`,
    `${colors.gray('REASON')} ${colors.underline(reason)}`,
    `Check the rule against the Declarative Net Request rule schema.\nThe build continues.`
  ].join('\n')
}

export function invalidManagedSchemaStructure(
  manifestField: string,
  file: string
) {
  return [
    `The managed storage schema listed in ${colors.blue(manifestField)} isn't a schema object.`,
    `${colors.gray('PATH')} ${colors.underline(file)}`,
    `${colors.gray('EXPECTED')} ${colors.underline('a top-level JSON object describing the schema')}`,
    `Update the file to contain a schema object.`
  ].join('\n')
}

export function jsonEmitSummary(
  feature: string,
  stats: {
    entries: number
    underPublic: number
    emitted: number
    missing: number
    validatedOk: number
    invalid: number
  }
) {
  return (
    `${prefix('debug')} json     emit feature=${feature} ` +
    `entries=${stats.entries} public=${stats.underPublic} ` +
    `emitted=${stats.emitted} missing=${stats.missing} ` +
    `valid=${stats.validatedOk} invalid=${stats.invalid}`
  )
}

export function jsonDepsTracked(addedCount: number) {
  return `${prefix('debug')} json     deps=${String(addedCount)}`
}

export function jsonIncludeSummary(
  totalFeatures: number,
  criticalCount: number
) {
  return (
    `${prefix('debug')} json     include features=${String(totalFeatures)} ` +
    `critical=${String(criticalCount)}`
  )
}
