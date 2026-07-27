//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import colors from 'pintor'
import {prefix} from '../../lib/messaging'

export function cssIntegrationsEnabled(integrations: string[]) {
  const names = integrations.length > 0 ? integrations.join(',') : 'none'
  return (
    `${prefix('debug')} css      integrations=${integrations.length} ` +
    `names=${names}`
  )
}

export function cssConfigsDetected(
  postcssConfig?: string,
  tailwindConfig?: string,
  browserslistSource?: string
) {
  const val = (v?: string) => v || 'none'
  return (
    `${prefix('debug')} css      config postcss=${val(postcssConfig)} ` +
    `tailwind=${val(tailwindConfig)} browserslist=${val(browserslistSource)}`
  )
}

// The caller owns the prefix here: every call site already wraps this in a
// debug line, so a glyph inside the string would print twice.
export function isUsingIntegration(name: string) {
  return `integration use=${name}`
}

export function youAreAllSet(name: string) {
  return `${prefix('success')} ${name} is installed.`
}

export function missingSassDependency() {
  return [
    `${prefix('error')} Couldn't compile the Sass styles.`,
    `The ${colors.brightBlue('"sass"')} package is not installed in your project.`,
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
    `${prefix('warn')} PostCSS plugin ${colors.brightBlue(`"${pluginName}"`)} could not be resolved from ${colors.underline(projectPath)}.`,
    'The plugin was skipped so the build can continue.',
    'Styles it would generate are missing from the output.',
    `Install it in your project to re-enable it, for example: ${colors.gray(`npm install --save-dev ${pluginName}`)}`
  ].join('\n')
}

export function cssParseErrorShippedVerbatim(
  resourcePath: string,
  error: unknown
) {
  const errObj = error as {reason?: unknown; message?: unknown} | undefined
  const reason =
    error && typeof error === 'object' && 'reason' in error
      ? String(errObj?.reason)
      : String(errObj?.message || error)
  return [
    `${prefix('warn')} Invalid CSS in ${colors.underline(resourcePath)}.`,
    `Reason: ${reason}.`,
    'Browsers skip invalid rules, so the stylesheet was copied as-is instead of failing the build.',
    'PostCSS/Tailwind processing was NOT applied to this file.',
    'Fix the CSS to re-enable it.'
  ].join('\n')
}

export function preprocessorShippedUncompiled(
  resourcePath: string,
  tool: 'sass' | 'less'
) {
  const pkg = tool === 'sass' ? 'sass' : 'less'
  return [
    `${prefix('warn')} ${colors.underline(resourcePath)} shipped UNCOMPILED.`,
    `The ${colors.brightBlue(`"${pkg}"`)} package is not installed in this project.`,
    `The raw ${tool === 'sass' ? 'Sass/SCSS' : 'Less'} source was copied as-is into the output .css, which browsers will treat as broken CSS (unstyled surfaces).`,
    `Install it to compile this file, for example: ${colors.gray(`npm install --save-dev ${pkg}`)}`
  ].join('\n')
}

export function deadCssUrlRef(issuerPath: string, request: string) {
  return [
    `Missing file in ${colors.underline(issuerPath)}.`,
    `The ${colors.yellow(`url(${request})`)} reference points to a file that exists nowhere in the project.`,
    `Chrome applies the rest of the stylesheet and 404s this reference silently, so it is likely dead code.`,
    `Set ${colors.yellow('EXTENSION_STRICT_REFS=true')} to make this a build error.`,
    '',
    `${colors.red('NOT FOUND')} ${colors.underline(request)}`
  ].join('\n')
}
