//      ██╗███████╗ ██████╗ ███╗   ██╗
//      ██║██╔════╝██╔═══██╗████╗  ██║
//      ██║███████╗██║   ██║██╔██╗ ██║
// ██   ██║╚════██║██║   ██║██║╚██╗██║
// ╚█████╔╝███████║╚██████╔╝██║ ╚████║
//  ╚════╝ ╚══════╝ ╚═════╝ ╚═╝  ╚═══╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import colors from 'pintor'

export function entryNotFoundMessageOnly(
  manifestField: string,
  absPath?: string
) {
  const lines: string[] = []
  lines.push(
    `Check the ${colors.yellow(manifestField)} field in your ${colors.yellow('manifest.json')} file.`
  )
  if (absPath) {
    lines.push('')
    lines.push(`${colors.red('NOT FOUND')} ${colors.underline(absPath)}`)
  }
  return lines.join('\n')
}

export function jsonMissingFile(
  manifestField: string,
  filePath: string,
  opts?: {publicRootHint?: boolean}
) {
  const lines: string[] = []

  lines.push(
    `Check the ${colors.yellow(manifestField)} field in your ${colors.yellow('manifest.json')} file.`
  )
  lines.push(
    `The JSON path must point to an existing file that will be packaged with the extension.`
  )
  lines.push(
    `Browsers can reject or crash the extension when required JSON files (like rulesets or managed schemas) are missing. We fail the build early to protect you.`
  )

  if (opts?.publicRootHint) {
    lines.push(
      `Paths starting with '/' are resolved from the extension output root (served from ${colors.yellow('public/')}), not your source directory.`
    )
  }
  lines.push('')
  lines.push(`${colors.red('NOT FOUND')} ${colors.underline(filePath)}`)

  return lines.join('\n')
}

export function invalidJsonSyntax(
  manifestField: string,
  file: string,
  cause: string
) {
  return [
    `Invalid JSON`,
    ``,
    `Check the ${colors.yellow(manifestField)} field in your ${colors.yellow('manifest.json')} file.`,
    `The JSON at ${colors.underline(file)} could not be parsed:`,
    `${colors.red(cause)}`
  ].join('\n')
}

export function invalidRulesetStructure(manifestField: string, file: string) {
  return [
    `Invalid Declarative Net Request ruleset`,
    ``,
    `Check the ${colors.yellow(manifestField)} field in your ${colors.yellow('manifest.json')} file.`,
    `Chrome expects a top-level JSON array of rule objects.`,
    `${colors.red('INVALID SHAPE')} ${colors.underline(file)}`
  ].join('\n')
}

export function invalidManagedSchemaStructure(
  manifestField: string,
  file: string
) {
  return [
    `Invalid managed storage schema`,
    ``,
    `Check the ${colors.yellow(manifestField)} field in your ${colors.yellow('manifest.json')} file.`,
    `Expected a top-level JSON object describing the schema.`,
    `${colors.red('INVALID SHAPE')} ${colors.underline(file)}`
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
    `JSON ${colors.yellow(feature)} — ` +
    `entries ${colors.gray(String(stats.entries))}, ` +
    `public ${colors.gray(String(stats.underPublic))}, ` +
    `emitted ${colors.gray(String(stats.emitted))}, ` +
    `missing ${colors.gray(String(stats.missing))}, ` +
    `valid ${colors.gray(String(stats.validatedOk))}, ` +
    `invalid ${colors.gray(String(stats.invalid))}`
  )
}

export function jsonDepsTracked(addedCount: number) {
  return `JSON file dependencies tracked: ${colors.gray(String(addedCount))}`
}

export function jsonIncludeSummary(
  totalFeatures: number,
  criticalCount: number
) {
  return (
    `JSON include summary — features ${colors.gray(String(totalFeatures))}, ` +
    `critical ${colors.gray(String(criticalCount))}`
  )
}

export function jsonManifestChangeDetected(
  field: string,
  before?: string,
  after?: string
) {
  const parts = [
    `Manifest JSON change detected in ${colors.yellow(field)}`,
    before ? `${colors.gray('before')} ${colors.underline(before)}` : '',
    after ? `${colors.gray('after')} ${colors.underline(after)}` : ''
  ].filter(Boolean)
  return parts.join(' — ')
}
