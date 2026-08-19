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
    `The ${colors.blue('sass')} package isn't installed in your project.`,
    `Add it to your devDependencies:`,
    `- ${colors.blue('npm install --save-dev sass')}`,
    `- ${colors.blue('pnpm add -D sass')}`
  ].join('\n')
}

export function postCssPluginNotResolved(
  pluginName: string,
  projectPath: string
) {
  return [
    `${prefix('warn')} Couldn't resolve the PostCSS plugin ${colors.blue(pluginName)}.`,
    'The plugin was skipped so the build can continue.',
    'Styles it would generate are missing from the output.',
    `${colors.gray('PATH')} ${colors.underline(projectPath)}`,
    `Install it in your project to re-enable it: ${colors.blue(`npm install --save-dev ${pluginName}`)}`
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
    `${prefix('warn')} The CSS in this file doesn't parse, so it was copied as-is.`,
    `${colors.gray('PATH')} ${colors.underline(resourcePath)}`,
    `${colors.gray('REASON')} ${reason}`,
    `Browsers skip rules they can't parse, so the build kept going.`,
    `PostCSS and Tailwind processing wasn't applied to this file.`,
    'Fix the CSS to re-enable processing.'
  ].join('\n')
}

export function preprocessorShippedUncompiled(
  resourcePath: string,
  tool: 'sass' | 'less'
) {
  const pkg = tool === 'sass' ? 'sass' : 'less'
  const language = tool === 'sass' ? 'Sass/SCSS' : 'Less'
  return [
    `${prefix('warn')} This ${language} file shipped uncompiled.`,
    `${colors.gray('PATH')} ${colors.underline(resourcePath)}`,
    `The ${colors.blue(pkg)} package isn't installed in this project.`,
    `The raw ${language} source was copied as-is into the output .css.`,
    `Browsers treat it as broken CSS, so those surfaces render unstyled.`,
    `Install it to compile this file: ${colors.blue(`npm install --save-dev ${pkg}`)}`
  ].join('\n')
}

export function deadCssUrlRef(issuerPath: string, request: string) {
  return [
    `A ${colors.blue(`url(${request})`)} reference points to a file that exists nowhere in the project.`,
    `${colors.gray('PATH')} ${colors.underline(issuerPath)}`,
    `${colors.gray('NOT FOUND')} ${colors.underline(request)}`,
    `Chrome applies the rest of the stylesheet and 404s this reference silently, so it's likely dead code.`,
    `Set ${colors.blue('EXTENSION_STRICT_REFS=true')} to make this a build error.`
  ].join('\n')
}

export function lateCssImportIgnored(issuerPath: string, line?: number) {
  const where = line ? `${issuerPath}:${line}` : issuerPath
  return [
    `An ${colors.blue('@import')} rule comes after other rules, so browsers skip it.`,
    `${colors.gray('PATH')} ${colors.underline(where)}`,
    `Chrome applies the rest of the stylesheet and ignores this import, so the build kept going.`,
    `Move the ${colors.blue('@import')} above every other rule to make it load.`
  ].join('\n')
}
