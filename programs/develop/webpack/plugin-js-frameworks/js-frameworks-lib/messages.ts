import colors from 'pintor'

export function installingRootDependencies(integration: string) {
  return (
    `${colors.gray('►►►')} ${integration} dependencies are being installed. ` +
    `This only happens for core contributors...`
  )
}

export function integrationInstalledSuccessfully(integration: string) {
  return `${colors.green('►►►')} ${integration} dependencies installed successfully.`
}

export function isUsingIntegration(name: string) {
  return `${colors.gray('►►►')} Using ${colors.brightBlue(name)}...`
}

export function youAreAllSet(name: string) {
  return `${colors.green('►►►')} ${name} installation completed. Run again to proceed.`
}

export function creatingTSConfig() {
  return `${colors.gray('►►►')} Creating default tsconfig.json...`
}

export function failedToInstallIntegration(
  integration: string,
  error: unknown
) {
  return (
    `${colors.red('ERROR')} ${colors.brightBlue(integration)} Installation Error\n` +
    `${colors.red('Failed to detect package manager or install dependencies.')}\n` +
    `${colors.red(String(error ?? ''))}`
  )
}

export function isUsingCustomLoader(loaderPath: string) {
  return `${colors.gray('►►►')} Using custom loader: ${colors.yellow(loaderPath)}.`
}
