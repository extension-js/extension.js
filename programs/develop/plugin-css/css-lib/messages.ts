//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import colors from 'pintor'
import {deadCssUrlRef} from '../../lib/css/messages'
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

export {isUsingIntegration} from '../../lib/integration-message'

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
  fix = 'Fix the imported file so its rules ship with this stylesheet.',
  writtenIn?: string
) {
  return [
    `${prefix('warn')} Couldn't bring an ${colors.blue('@import')} into this content script stylesheet, so the rules of that file will not load.`,
    `${colors.gray('PATH')} ${colors.underline(issuerPath)}`,
    `${colors.gray('IMPORT')} ${colors.blue(request)}`,
    ...(writtenIn && writtenIn !== issuerPath
      ? [`${colors.gray('WRITTEN IN')} ${colors.underline(writtenIn)}`]
      : []),
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

// The import leads the sheet so it loads at all, at the cost of its place.
export function cssImportMovedAhead(
  issuerPath: string,
  statement: string,
  writtenIn?: string
) {
  return [
    `${prefix('warn')} Moved an ${colors.blue('@import')} to the top of this content script stylesheet, ahead of rules it used to follow.`,
    `${colors.gray('PATH')} ${colors.underline(issuerPath)}`,
    `${colors.gray('IMPORT')} ${colors.blue(statement)}`,
    ...(writtenIn && writtenIn !== issuerPath
      ? [`${colors.gray('WRITTEN IN')} ${colors.underline(writtenIn)}`]
      : []),
    'The sheets imported before it are now rules in this file, and a browser skips an @import that follows a rule.',
    `Write this ${colors.blue('@import')} first, or set the order with ${colors.blue('@layer')}, to keep the cascade you wrote.`
  ].join('\n')
}

const IMPORT_SKIP_REASONS = {
  'unnamed-layer': [
    'Its sheet came in under an unnamed layer, which no @import can name, and a browser skips an @import inside a block.',
    `Name the layer on the import that brings its sheet in, as in ${colors.blue('layer(name)')}.`
  ],
  'media-never': [
    'Its sheet came in under one media type and this import asks for another, and no device is both.',
    `Remove this ${colors.blue('@import')}, or change one of the two media types.`
  ],
  'media-not-joined': [
    'Its sheet came in under a media query that cannot be joined with the one on this import, and a browser skips an @import inside a block.',
    `Move this ${colors.blue('@import')} to the content script stylesheet itself, with both conditions written out.`
  ],
  'unknown-function': [
    'It carries a function CSS does not define and its sheet came in under a condition, and a browser skips an @import inside a block.',
    `Move this ${colors.blue('@import')} to the content script stylesheet itself.`
  ],
  'no-target': [
    'What it names could not be read as a string or a url() and its sheet came in under a condition, and a browser skips an @import inside a block.',
    `Write the target of this ${colors.blue('@import')} as a string, or move it to the content script stylesheet itself.`
  ]
}

// Known only once every tool ran: no plugin brought this import in.
export function cssImportStillInSheet(issuerPath: string, statement: string) {
  return [
    `${prefix('warn')} An ${colors.blue('@import')} is still in this content script stylesheet after every tool ran, so the rules it names will not load.`,
    `${colors.gray('PATH')} ${colors.underline(issuerPath)}`,
    `${colors.gray('IMPORT')} ${colors.blue(statement)}`,
    'A content script stylesheet loads from a data: URL, where the browser fetches no relative import.',
    'Name a file beside the sheet, or add the PostCSS plugin that brings this import in.'
  ].join('\n')
}

export function cssImportSkippedInBlock(
  issuerPath: string,
  statement: string,
  writtenIn: string,
  why: keyof typeof IMPORT_SKIP_REASONS
) {
  return [
    `${prefix('warn')} An ${colors.blue('@import')} in a sheet this content script stylesheet imports will not load.`,
    `${colors.gray('PATH')} ${colors.underline(issuerPath)}`,
    `${colors.gray('IMPORT')} ${colors.blue(statement)}`,
    `${colors.gray('WRITTEN IN')} ${colors.underline(writtenIn)}`,
    ...IMPORT_SKIP_REASONS[why]
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

export function cssUrlSheetRefsNotFollowed(sheetPath: string, refs: string[]) {
  return [
    `${prefix('warn')} This stylesheet is imported with ${colors.blue('?url')}, so it ships as a file of its own and these addresses in it will not load.`,
    `${colors.gray('PATH')} ${colors.underline(sheetPath)}`,
    `${colors.gray('REFS')} ${refs.join(', ')}`,
    `Move those files into ${colors.blue('public/')} and name them from the root, or import the stylesheet without ${colors.blue('?url')}.`
  ].join('\n')
}

export function stylesheetRuleTypeReplaced(type: string, extensions: string[]) {
  return [
    `${prefix('warn')} A rule in your config sets ${colors.yellow(`type: '${type}'`)} for ${extensions.join(', ')} files, and Extension.js compiles every stylesheet itself, so that type is not applied.`,
    `Remove ${colors.blue('type')} from the rule. Import a stylesheet with ${colors.blue('?url')} for its file URL or with ${colors.blue('?raw')} for its text.`
  ].join('\n')
}

// The same finding for a sheet an @import names, in the words of that rule.
function deadCssImportRef(issuerPath: string, request: string, strict = false) {
  return [
    `An ${colors.blue(`@import "${request}"`)} names a stylesheet that exists nowhere in the project.`,
    `${colors.gray('PATH')} ${colors.underline(issuerPath)}`,
    `${colors.gray('NOT FOUND')} ${colors.underline(request)}`,
    'Chrome applies the rest of the stylesheet and skips this import silently, so the rules it names never load.',
    ...(strict
      ? []
      : [
          `Set ${colors.blue('EXTENSION_STRICT_REFS=true')} to make this a build error.`
        ])
  ].join('\n')
}

// One finding in the words of the rule that names the file.
export function deadCssRef(
  issuerPath: string,
  request: string,
  strict: boolean,
  viaImport: boolean
) {
  return viaImport
    ? deadCssImportRef(issuerPath, request, strict)
    : deadCssUrlRef(issuerPath, request, strict)
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

// The production minimizer can drop the rest of a sheet after a construct a
// browser skips, and the unminified sheet keeps both modes on the same rules.
export function cssMinifierDroppedRules(assetName: string, tokens: string[]) {
  return (
    `${prefix('warn')} The CSS minimizer dropped ${tokens.join(', ')} from ${colors.gray(assetName)}.\n` +
    'Shipped that stylesheet unminified so production keeps every rule development keeps.'
  )
}
