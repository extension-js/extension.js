//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import colors from 'pintor'

export function cssIntegrationsEnabled(integrations: string[]) {
  const list =
    integrations.length > 0
      ? integrations.map((n) => colors.yellow(n)).join(', ')
      : colors.gray('none')
  return `${colors.gray('►►►')} CSS: Integrations enabled (${colors.gray(String(integrations.length))}) ${list}`
}

export function cssConfigsDetected(
  postcssConfig?: string,
  stylelintConfig?: string,
  tailwindConfig?: string,
  browserslistSource?: string
) {
  const fmt = (v?: string) => (v ? colors.underline(v) : colors.gray('none'))
  return (
    `${colors.gray('►►►')} CSS: Configs\n` +
    `${colors.gray('POSTCSS')} ${fmt(postcssConfig)}\n` +
    `${colors.gray('STYLELINT')} ${fmt(stylelintConfig)}\n` +
    `${colors.gray('TAILWIND')} ${fmt(tailwindConfig)}\n` +
    `${colors.gray('BROWSERSLIST')} ${fmt(browserslistSource)}`
  )
}

export function isUsingIntegration(name: string) {
  return `${colors.gray('►►►')} Using ${colors.brightBlue(name)}...`
}

export function youAreAllSet(name: string) {
  return `${colors.green('►►►')} ${name} installation completed.`
}

export function optionalToolingSetup(
  integrations: string[] | undefined,
  fallback: string,
  isAuthor: boolean
) {
  const list =
    integrations && integrations.length > 0 ? integrations.join('/') : fallback
  const prefix = isAuthor
    ? colors.brightMagenta('►►► Author says')
    : colors.gray('►►►')
  return `${prefix} Setting up ${list} tooling... (this is a one time op)`
}

export function optionalToolingRootInstall(integration: string) {
  return `${colors.brightMagenta('►►► Author says')} [${integration}] Installing root dependencies for dev...`
}

export function optionalToolingReady(integration: string) {
  return `${colors.brightMagenta('►►► Author says')} ${integration} tooling ready.`
}

export function optionalInstallFailed(
  integration: string,
  error: unknown,
  isAuthor: boolean
) {
  const prefix = isAuthor
    ? colors.brightMagenta('ERROR Author says')
    : colors.red('ERROR')
  return `${prefix} [${integration}] Failed to install dependencies.\n${colors.red(
    String((error as Error)?.message || error)
  )}`
}

export function optionalInstallRootMissing(integration: string) {
  const prefix = colors.red('ERROR')
  return [
    `${prefix} [${integration}] Failed to locate the extension-develop runtime.`,
    'Optional tooling must install into the extension-develop package, not the user project.',
    'Reinstall Extension.js or run the command from a valid Extension.js installation.'
  ].join('\n')
}

export function optionalInstallManagerMissing(integration: string) {
  const prefix = colors.red('ERROR')
  return [
    `${prefix} [${integration}] No supported package manager found in PATH.`,
    'Install pnpm, npm, or yarn and retry.',
    'If you use pnpm, ensure it is available in your environment (e.g. corepack or PATH).'
  ].join('\n')
}

export function missingSassDependency() {
  const prefix = colors.red('►►►')
  return [
    `${prefix} SASS support requires the ${colors.brightBlue(
      '"sass"'
    )} package to be installed in your project.`,
    '',
    `Add it to your devDependencies, for example:`,
    `  ${colors.gray('npm install --save-dev sass')}`,
    `  ${colors.gray('pnpm add -D sass')}`,
    '',
    'Sample package.json:',
    '  {',
    '    "devDependencies": {',
    `      "sass": ${colors.yellow('"<version>"')}`,
    '    }',
    '  }'
  ].join('\n')
}
