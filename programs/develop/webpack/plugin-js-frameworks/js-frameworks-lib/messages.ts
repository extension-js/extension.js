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

export function jsFrameworksIntegrationsEnabled(integrations: string[]) {
  const list =
    integrations.length > 0
      ? integrations.map((n) => colors.yellow(n)).join(', ')
      : colors.gray('none')
  return `${colors.gray('►►►')} JS: Integrations enabled (${colors.gray(String(integrations.length))}) ${list}`
}

export function jsFrameworksConfigsDetected(
  tsConfigPath?: string,
  tsRoot?: string,
  targets?: string[]
) {
  const fmt = (v?: string) => (v ? colors.underline(v) : colors.gray('none'))
  const tgt =
    targets && targets.length
      ? targets.map((t) => colors.gray(t)).join(', ')
      : colors.gray('default')
  return (
    `${colors.gray('►►►')} JS: Configs\n` +
    `${colors.gray('TSCONFIG')} ${fmt(tsConfigPath)}\n` +
    `${colors.gray('TSROOT')} ${fmt(tsRoot)}\n` +
    `${colors.gray('SWC_TARGETS')} ${tgt}`
  )
}

export function jsFrameworksHmrSummary(enabled: boolean, frameworks: string[]) {
  const list =
    frameworks.length > 0
      ? frameworks.map((n) => colors.yellow(n)).join(', ')
      : colors.gray('none')
  return `${colors.gray('►►►')} JS: HMR ${enabled ? colors.green('enabled') : colors.gray('disabled')} for ${list}`
}
