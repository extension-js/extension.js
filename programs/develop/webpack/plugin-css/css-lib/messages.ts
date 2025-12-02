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
  return `${colors.green('►►►')} ${name} installation completed. Run again to proceed.`
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
