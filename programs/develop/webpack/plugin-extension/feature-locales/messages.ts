import colors from 'pintor'

export function manifestNotFoundMessageOnly() {
  return (
    `${colors.red('ERROR')} manifest.json\n\n` +
    `Ensure you have a ${colors.yellow('manifest.json')} file at the root directory of your project.`
  )
}

export function entryNotFoundMessageOnly(manifestField: string) {
  return (
    `File Not Found\n\n` +
    `Check the ${colors.yellow(manifestField)} field in your ${colors.yellow('manifest.json')} file.`
  )
}
