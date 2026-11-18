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

// `install` is the command for the project's own package manager.
export function missingSassDependency(install: string) {
  return [
    `${prefix('error')} Couldn't compile the Sass styles.`,
    `The ${colors.blue('sass')} package isn't installed in your project.`,
    `Add it to your devDependencies: ${colors.blue(install)}`
  ].join('\n')
}

export function postCssPluginNotResolved(
  pluginName: string,
  projectPath: string,
  install: string
) {
  return [
    `${prefix('warn')} Couldn't resolve the PostCSS plugin ${colors.blue(pluginName)}.`,
    'The plugin was skipped so the build can continue.',
    'Styles it would generate are missing from the output.',
    `${colors.gray('PATH')} ${colors.underline(projectPath)}`,
    `Install it in your project to re-enable it: ${colors.blue(install)}`
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
  tool: 'sass' | 'less',
  install: string
) {
  const pkg = tool === 'sass' ? 'sass' : 'less'
  const language = tool === 'sass' ? 'Sass/SCSS' : 'Less'

  return [
    `${prefix('warn')} This ${language} file shipped uncompiled.`,
    `${colors.gray('PATH')} ${colors.underline(resourcePath)}`,
    `The ${colors.blue(pkg)} package isn't installed in this project.`,
    `The raw ${language} source was copied as-is into the output .css.`,
    `Browsers treat it as broken CSS, so those surfaces render unstyled.`,
    `Install it to compile this file: ${colors.blue(install)}`
  ].join('\n')
}

function reasonOf(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export function tailwindSetupFailed(
  pluginId: string,
  projectPath: string,
  error: unknown
) {
  return [
    `${prefix('warn')} Couldn't start the Tailwind PostCSS plugin ${colors.blue(pluginId)}, so the build ran without it.`,
    `${colors.gray('PATH')} ${colors.underline(projectPath)}`,
    `${colors.gray('REASON')} ${reasonOf(error)}`,
    'Tailwind classes are missing from the output CSS.',
    `Install ${colors.blue('tailwindcss')} and ${colors.blue('@tailwindcss/postcss')} at the same major version, or name the plugin in your PostCSS config.`
  ].join('\n')
}

// `fix` is the command that puts the plugin in the project.
export function tailwindNotInstalled(projectPath: string, fix: string) {
  return [
    `${prefix('warn')} Couldn't find the Tailwind PostCSS plugin in this project, so the build ran without it.`,
    `${colors.gray('PATH')} ${colors.underline(projectPath)}`,
    'Tailwind classes are missing from the output CSS.',
    `Install it in your project: ${colors.blue(fix)}`
  ].join('\n')
}

export function postCssConfigNameIgnored(configPath: string, rename: string) {
  return [
    `${prefix('warn')} PostCSS reads no config by this name, so the file was ignored.`,
    `${colors.gray('PATH')} ${colors.underline(configPath)}`,
    `Rename it to ${colors.blue(rename)} to apply it.`
  ].join('\n')
}

export function postCssConfigNeedsRestart(configPath: string) {
  return [
    `${prefix('warn')} The PostCSS setup changed in a way this session can't apply while it runs.`,
    `${colors.gray('PATH')} ${colors.underline(configPath)}`,
    `Stop it and run ${colors.blue('extension dev')} again to apply the change.`
  ].join('\n')
}

export function cssImportLeftAsWritten(
  issuerPath: string,
  request: string,
  reason: string,
  fix = 'Fix the imported file so its rules ship with this stylesheet.'
) {
  return [
    `${prefix('warn')} Couldn't bring an ${colors.blue('@import')} into this content script stylesheet, so it stayed as written.`,
    `${colors.gray('PATH')} ${colors.underline(issuerPath)}`,
    `${colors.gray('IMPORT')} ${colors.blue(request)}`,
    `${colors.gray('REASON')} ${reason}`,
    'A content script stylesheet loads from a data: URL, where the browser fetches no relative import.',
    fix
  ].join('\n')
}

export function cssImportCycle(issuerPath: string, files: string[]) {
  return [
    `${prefix('warn')} Sheets this content script stylesheet brings in with ${colors.blue('@import')} import one another, so the import that closes the loop was dropped.`,
    `${colors.gray('PATH')} ${colors.underline(issuerPath)}`,
    `${colors.gray('LOOP')} ${files.map((file) => colors.underline(file)).join(' > ')}`,
    'Each sheet came in once, where it was first imported.',
    `Remove one of these ${colors.blue('@import')} rules to say which sheet comes first.`
  ].join('\n')
}

export function cssImportReadAsPackage(issuerPath: string, statement: string) {
  return [
    `${prefix('warn')} An ${colors.blue('@import')} in this content script stylesheet names a package, and a file by that name sits beside the sheet.`,
    `${colors.gray('PATH')} ${colors.underline(issuerPath)}`,
    `${colors.gray('IMPORT')} ${colors.blue(statement)}`,
    `A name with no ${colors.blue('./')} ahead of it is looked up as a package, so the rules of that file did not come in.`,
    `Start the name with ${colors.blue('./')} to bring the file in.`
  ].join('\n')
}

// The import leads the sheet so it loads at all, at the cost of its place.
export function cssImportMovedAhead(issuerPath: string, statement: string) {
  return [
    `${prefix('warn')} Moved an ${colors.blue('@import')} to the top of this content script stylesheet, ahead of rules it used to follow.`,
    `${colors.gray('PATH')} ${colors.underline(issuerPath)}`,
    `${colors.gray('IMPORT')} ${colors.blue(statement)}`,
    'The sheets imported before it are now rules in this file, and a browser skips an @import that follows a rule.',
    `Write this ${colors.blue('@import')} first, or set the order with ${colors.blue('@layer')}, to keep the cascade you wrote.`
  ].join('\n')
}

export function cssImportSkippedInBlock(
  issuerPath: string,
  statement: string,
  writtenIn: string
) {
  return [
    `${prefix('warn')} An ${colors.blue('@import')} in a sheet this content script stylesheet imports will not load.`,
    `${colors.gray('PATH')} ${colors.underline(issuerPath)}`,
    `${colors.gray('IMPORT')} ${colors.blue(statement)}`,
    `${colors.gray('WRITTEN IN')} ${colors.underline(writtenIn)}`,
    'Its sheet came in under a layer, media or supports condition this import cannot carry, and a browser skips an @import inside a block.',
    `Move this ${colors.blue('@import')} to the content script stylesheet itself.`
  ].join('\n')
}

export function cssUrlRewriteSkipped(resourcePath: string, error: unknown) {
  return [
    `${prefix('warn')} Couldn't rewrite the url() references in this stylesheet, so they shipped as written.`,
    `${colors.gray('PATH')} ${colors.underline(resourcePath)}`,
    `${colors.gray('REASON')} ${reasonOf(error)}`,
    "A url() here may point at a path the extension can't load.",
    'Check each url() in this file resolves from the file itself or from public/.'
  ].join('\n')
}

// Under strict refs the reader already set the variable the hint names.
export function deadCssUrlRef(
  issuerPath: string,
  request: string,
  strict = false
) {
  return [
    `A ${colors.blue(`url(${request})`)} reference points to a file that exists nowhere in the project.`,
    `${colors.gray('PATH')} ${colors.underline(issuerPath)}`,
    `${colors.gray('NOT FOUND')} ${colors.underline(request)}`,
    `Chrome applies the rest of the stylesheet and 404s this reference silently, so it's likely dead code.`,
    ...(strict
      ? []
      : [
          `Set ${colors.blue('EXTENSION_STRICT_REFS=true')} to make this a build error.`
        ])
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

// The remedies differ by how the script reaches the page: only a declared
// script has a manifest entry to list a sheet in, or a sheet shipped beside it.
export function unplacedStyleImport(
  issuerPath: string,
  imports: Array<{request: string; line: number}>,
  declared: boolean
) {
  const first = imports[0]
  const where = first?.line ? `${issuerPath}:${first.line}` : issuerPath
  const request = first?.request || './styles.css'

  return [
    `${prefix('warn')} A stylesheet imported only for its side effect styles nothing in a content script.`,
    `${colors.gray('PATH')} ${colors.underline(where)}`,
    ...imports.map(
      (entry) =>
        `${colors.gray('IMPORT')} ${colors.blue(`import '${entry.request}'`)}`
    ),
    `There the import evaluates to the sheet as a ${colors.blue('data:')} URL, and no code reads it.`,
    `Read the value and place it: ${colors.blue(`import href from '${request}'`)}, then set it on a ${colors.blue('<link rel="stylesheet">')}.`,
    ...(declared
      ? [
          `Or list the sheet under ${colors.blue('content_scripts[].css')} in manifest.json, or use a CSS module (${colors.blue('.module.css')}).`,
          `Extension.js places it for you only in the shadow root of a host marked ${colors.blue('data-extension-root')}.`
        ]
      : [])
  ].join('\n')
}

// A config file that is there but cannot be read must not look like no
// config at all: the two cases need different fixes.
export function postCssConfigUnreadable(configPath: string, error: unknown) {
  return (
    `${prefix('warn')} Could not load the PostCSS config at ${colors.gray(configPath)}.\n` +
    `${String((error as Error)?.message || error)}\n` +
    'The build continues without it, so none of its plugins run. Fix the file or remove it.'
  )
}

export function postCssConfigPluginsShape(configPath: string, found: string) {
  return (
    `${prefix('warn')} The PostCSS config at ${colors.gray(configPath)} lists plugins as ${found}.\n` +
    'PostCSS expects an array or an object keyed by plugin name.\n' +
    'The build continues without this config, so none of its plugins run.'
  )
}

// The production minimizer error-recovers differently from a browser and can
// drop the rest of a sheet after a construct the browser skips; shipping the
// unminified sheet keeps production and development on the same rules.
export function cssMinifierDroppedRules(assetName: string, tokens: string[]) {
  return (
    `${prefix('warn')} The CSS minimizer dropped ${tokens.join(', ')} from ${colors.gray(assetName)}.\n` +
    'Shipped that stylesheet unminified so production keeps every rule development keeps.'
  )
}
