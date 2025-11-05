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
