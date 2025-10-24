import colors from 'pintor'

export function isUsingIntegration(name: string) {
  return `${colors.gray('►►►')} Using ${colors.brightBlue(name)}...`
}

export function youAreAllSet(name: string) {
  return `${colors.green('►►►')} ${name} installation completed. Run again to proceed.`
}
