import colors from 'pintor'

export function entryNotFoundMessageOnly(manifestField: string) {
  return (
    `File Not Found\n\n` +
    `Check the ${colors.yellow(manifestField)} field in your ${colors.yellow('manifest.json')} file.`
  )
}
