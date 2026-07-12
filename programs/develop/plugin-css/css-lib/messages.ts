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
  return `${colors.gray('⏵⏵⏵')} CSS: Integrations enabled (${colors.gray(String(integrations.length))}) ${list}`
}

export function cssConfigsDetected(
  postcssConfig?: string,
  tailwindConfig?: string,
  browserslistSource?: string
) {
  const fmt = (v?: string) => (v ? colors.underline(v) : colors.gray('none'))
  return (
    `${colors.gray('⏵⏵⏵')} CSS: Configs\n` +
    `${colors.gray('POSTCSS')} ${fmt(postcssConfig)}\n` +
    `${colors.gray('TAILWIND')} ${fmt(tailwindConfig)}\n` +
    `${colors.gray('BROWSERSLIST')} ${fmt(browserslistSource)}`
  )
}

export function isUsingIntegration(name: string) {
  return `${colors.gray('⏵⏵⏵')} Using ${colors.brightBlue(name)}...`
}

export function youAreAllSet(name: string) {
  return `${colors.green('⏵⏵⏵')} ${name} installation completed.`
}

export function missingSassDependency() {
  const prefix = colors.red('⏵⏵⏵')
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

export function postCssPluginNotResolved(
  pluginName: string,
  projectPath: string
) {
  return [
    `${colors.yellow('⏵⏵⏵')} PostCSS plugin ${colors.brightBlue(`"${pluginName}"`)} could not be resolved from ${colors.underline(projectPath)}.`,
    'The plugin was skipped so the build can continue. Styles it would generate are missing from the output.',
    `Install it in your project to re-enable it, for example: ${colors.gray(`npm install --save-dev ${pluginName}`)}`
  ].join('\n')
}

export function cssParseErrorShippedVerbatim(
  resourcePath: string,
  error: unknown
) {
  const reason =
    error && typeof error === 'object' && 'reason' in (error as any)
      ? String((error as any).reason)
      : String((error as any)?.message || error)
  return [
    `${colors.yellow('⏵⏵⏵')} Invalid CSS in ${colors.underline(resourcePath)} — ${reason}.`,
    'Browsers skip invalid rules, so the stylesheet was copied as-is instead of failing the build.',
    'PostCSS/Tailwind processing was NOT applied to this file. Fix the CSS to re-enable it.'
  ].join('\n')
}

export function deadCssUrlRef(issuerPath: string, request: string) {
  return [
    `Missing file in ${colors.underline(issuerPath)}.`,
    `The ${colors.yellow(`url(${request})`)} reference points to a file that exists nowhere in the project.`,
    `Chrome applies the rest of the stylesheet and 404s this reference silently — likely dead code. Set ${colors.yellow('EXTENSION_STRICT_REFS=true')} to make this a build error.`,
    '',
    `${colors.red('NOT FOUND')} ${colors.underline(request)}`
  ].join('\n')
}
