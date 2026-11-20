//      ██╗███████╗ ██████╗ ███╗   ██╗
//      ██║██╔════╝██╔═══██╗████╗  ██║
//      ██║███████╗██║   ██║██╔██╗ ██║
// ██   ██║╚════██║██║   ██║██║╚██╗██║
// ╚█████╔╝███████║╚██████╔╝██║ ╚████║
//  ╚════╝ ╚══════╝ ╚═════╝ ╚═╝  ╚═══╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import colors from 'pintor'
import {prefix} from '../../lib/messaging'

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
      `A path starting with '/' resolves from the extension root, so the file must sit at that path in your project or in ${colors.blue('public/')}.`
    )
  }

  lines.push(
    `Update the JSON path in your ${colors.blue('manifest.json')} to a file that ships with the extension.`
  )

  return lines.join('\n')
}

export function jsonPathIsFolder(
  manifestField: string,
  folderPath: string,
  opts?: {fatal?: boolean}
) {
  const lines: string[] = []
  lines.push(
    `The JSON path listed in ${colors.blue(manifestField)} is a folder, not a file.`
  )

  lines.push(`${colors.gray('FOLDER')} ${colors.underline(folderPath)}`)
  lines.push(
    opts?.fatal
      ? `Browsers can reject or crash the extension when required JSON files like rulesets cannot be loaded.\nThe build stops here.`
      : `Browsers can reject or misread the extension when this file cannot be loaded.\nThe build continues.`
  )

  lines.push(
    `Point ${colors.blue(manifestField)} in your ${colors.blue('manifest.json')} at a JSON file, for example one inside that folder.`
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

function ruleIdList(ids: readonly number[]) {
  const shown = ids.slice(0, 5).join(', ')

  return ids.length > 5 ? `${shown} and ${ids.length - 5} more` : shown
}

export function rulesetDuplicateRuleIds(
  manifestField: string,
  file: string,
  ids: readonly number[]
) {
  return [
    `The Declarative Net Request ruleset listed in ${colors.blue(manifestField)} uses a rule id more than once, and Chrome refuses to load an extension whose ruleset does.`,
    `${colors.gray('PATH')} ${colors.underline(file)}`,
    `${colors.gray('RULE')} ${colors.underline(`id ${ruleIdList(ids)}`)}`,
    `Firefox loads the same ruleset and leaves a rule out. Give every rule in the file its own id.\nThe build continues.`
  ].join('\n')
}

export function rulesetRegexChromeCannotCompile(
  manifestField: string,
  file: string,
  ids: readonly number[],
  construct: string
) {
  return [
    `A rule in the Declarative Net Request ruleset listed in ${colors.blue(manifestField)} has a ${colors.yellow('regexFilter')} Chrome cannot compile, and Chrome refuses to load an extension whose ruleset has one.`,
    `${colors.gray('PATH')} ${colors.underline(file)}`,
    `${colors.gray('RULE')} ${colors.underline(`id ${ruleIdList(ids)}`)}`,
    `${colors.gray('REASON')} ${colors.underline(`the filter uses ${construct}`)}`,
    `Chrome reads the filter as RE2, which has no lookahead, lookbehind or backreference, and Firefox accepts the rule. Rewrite the filter without it.\nThe build continues.`
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

// A key names one output file, so it takes one source file.
export function jsonIncludeValueNotOneString(key: string, value: unknown) {
  const got = Array.isArray(value) ? 'a list' : `a ${typeof value}`

  return `JsonPlugin takes one file path per key, and the key ${key} has ${got}. Pass one path, or give each file its own key.`
}
