// ███████╗██████╗ ███████╗ ██████╗██╗ █████╗ ██╗      ███████╗ ██████╗ ██╗     ██████╗ ███████╗██████╗ ███████╗
// ██╔════╝██╔══██╗██╔════╝██╔════╝██║██╔══██╗██║      ██╔════╝██╔═══██╗██║     ██╔══██╗██╔════╝██╔══██╗██╔════╝
// ███████╗██████╔╝█████╗  ██║     ██║███████║██║█████╗█████╗  ██║   ██║██║     ██║  ██║█████╗  ██████╔╝███████╗
// ╚════██║██╔═══╝ ██╔══╝  ██║     ██║██╔══██║██║╚════╝██╔══╝  ██║   ██║██║     ██║  ██║██╔══╝  ██╔══██╗╚════██║
// ███████║██║     ███████╗╚██████╗██║██║  ██║███████╗ ██║     ╚██████╔╝███████╗██████╔╝███████╗██║  ██║███████║
// ╚══════╝╚═╝     ╚══════╝ ╚═════╝╚═╝╚═╝  ╚═╝╚══════╝ ╚═╝      ╚═════╝ ╚══════╝╚═════╝ ╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import colors from 'pintor'
import {prefix} from '../lib/messaging'
import {displayPath} from '../lib/paths'

export function serverRestartRequiredFromSpecialFolderMessageOnly(
  addingOrRemoving: string,
  folder: string,
  typeOfAsset: string
) {
  // Warn, not error: the build succeeded and only a restart is outstanding.
  // The old `ERROR in ` head also collided with the rspack stats text that
  // downstream tooling matches on, so a restart notice read as a failed build.
  return (
    `${prefix('warn')} ${addingOrRemoving} ${colors.yellow(typeOfAsset)} in ` +
    `${colors.underline(`${folder}/`)} changes the extension entrypoints.\n` +
    `Restart the dev server to apply the change.`
  )
}

// A page or a stylesheet that reaches into public/ once the folder is off
// ships a reference to a file nothing copies.
export function publicFolderOffRef(
  asset: string,
  via: 'a CSS url()' | 'an HTML src/href attribute',
  ref: string
) {
  return (
    `${asset} references ${colors.underline(ref)} from ${via}, and only public/ holds that file.\n` +
    `The public folder is turned off, ${colors.blue('folders.public')} is ${colors.blue('false')} in extension.config.js, so the file does not ship and the reference answers 404.\n` +
    'Turn the folder back on, or move the file out of public/.'
  )
}

// Both folders print the way the session card prints paths: relative to the
// project when inside it, otherwise with the home dir collapsed to `~`.
export function publicMustBeAtProjectRoot(
  foundAt: string,
  expectedAt: string,
  projectRoot: string
) {
  return (
    'The public folder sits in the legacy next-to-manifest location.\n' +
    `GOT ${displayPath(foundAt, projectRoot)}\n` +
    `EXPECTED ${displayPath(expectedAt, projectRoot)}\n` +
    'Static files ship from the extension root, so public/ is ' +
    'canonically placed at the project root.\n' +
    'The build uses it either way.\n' +
    'Move the folder to the project root to silence this warning.'
  )
}

export function publicFolderShadowed(
  usedAt: string,
  ignoredAt: string,
  projectRoot: string
) {
  return (
    'Two public folders were found and only one is copied into the build.\n' +
    `USING ${displayPath(usedAt, projectRoot)}\n` +
    `IGNORED ${displayPath(ignoredAt, projectRoot)}\n` +
    'public/ is canonically placed at the project root, and that copy wins.\n' +
    'Files that exist only in the ignored folder do not ship.\n' +
    'Move or merge the ignored folder to silence this warning.'
  )
}

export function publicFolderAppeared(publicDir: string, projectRoot: string) {
  return (
    `${displayPath(publicDir, projectRoot)} appeared after the session started.\n` +
    'Its files are copied only by a session that saw the folder at startup.\n' +
    'Restart `extension dev` to ship them.'
  )
}

export function specialFoldersSetupSummary(
  hasPublic: boolean,
  copyEnabled: boolean,
  ignoredCount: number
) {
  return (
    `${prefix('debug')} folders  setup public=${String(hasPublic)} ` +
    `copy=${String(copyEnabled)} ignored=${String(ignoredCount)}`
  )
}

export function specialFolderChangeDetected(
  action: 'add' | 'remove',
  folder: 'pages' | 'scripts',
  relativePath: string
) {
  return (
    `${prefix('debug')} folders  change=${action} scope=${folder} ` +
    `path=${relativePath}`
  )
}

export function packageScriptLeftOut(relativePaths: string[]) {
  const one = relativePaths.length === 1
  const list = relativePaths
    .map((entry) => `  ${colors.yellow(entry)}`)
    .join('\n')

  return (
    `${prefix('debug')} Left ${relativePaths.length} ` +
    `${one ? 'entry' : 'entries'} in ${colors.yellow('scripts/')} out of ` +
    `the build, a package.json script runs ${one ? 'it' : 'them'} and ` +
    `nothing in the extension names ${one ? 'it' : 'them'}:\n${list}`
  )
}

// Names only: what an env file holds never reaches a message.
export function publicEnvFilesLeftOut(
  relativePaths: string[],
  browser: string
) {
  const one = relativePaths.length === 1
  const shown = relativePaths.slice(0, 10)
  const more = relativePaths.length - shown.length
  const list =
    shown.map((entry) => colors.yellow(entry)).join(', ') +
    (more > 0 ? ` and ${more} more` : '')

  return (
    `${list} ${one ? 'is an env file' : 'are env files'}, and ` +
    `${one ? 'it is' : 'they are'} left out of the ${colors.blue(browser)} build.\n` +
    'Every file in the public folder ships inside the extension, where ' +
    'anyone who installs it can read it. Env files are read from the ' +
    `project root, so move ${one ? 'it' : 'them'} there, or delete ${one ? 'it' : 'them'}.`
  )
}

// Names only, like the env files above: no linked file is opened to say this.
export function publicLinkedFilesLeftOut(
  relativePaths: string[],
  browser: string
) {
  const one = relativePaths.length === 1
  const shown = relativePaths.slice(0, 10)
  const more = relativePaths.length - shown.length
  const list =
    shown.map((entry) => colors.yellow(entry)).join(', ') +
    (more > 0 ? ` and ${more} more` : '')

  return (
    `${list} ${one ? 'is a link' : 'are links'}, and ` +
    `${one ? 'it is' : 'they are'} left out of the ${colors.blue(browser)} build.\n` +
    'Every file in the public folder ships inside the extension, where ' +
    'anyone who installs it can read it, so the build never copies what a ' +
    'link brings from outside the project or from node_modules. To ship ' +
    `${one ? 'it' : 'them'}, copy the ${one ? 'file' : 'files'} into the public folder.`
  )
}

// Names only, like the public one above: no file is opened to say this.
export function entryFolderFilesLeftOut(
  relativePaths: string[],
  browser: string
) {
  const one = relativePaths.length === 1
  const shown = relativePaths.slice(0, 10)
  const more = relativePaths.length - shown.length
  const list =
    shown.map((entry) => colors.yellow(entry)).join(', ') +
    (more > 0 ? ` and ${more} more` : '')

  return (
    `${list} ${one ? 'is' : 'are'} left out of the ${colors.blue(browser)} build.\n` +
    'The build never bundles env files, tooling files or repository files, ' +
    'or a file a link brings from outside the project or from ' +
    'node_modules. To build ' +
    `${one ? 'it' : 'them'}, give ${one ? 'it' : 'them'} another name or ` +
    `copy ${one ? 'it' : 'them'} into the project.`
  )
}

export function publicFileCollidesWithEntry(
  publicPath: string,
  emittedPath: string
) {
  return (
    `${colors.yellow(publicPath)} would be written to ` +
    `${colors.yellow(emittedPath)}, which this extension already generates ` +
    `from its manifest, so two different files claim one output path. ` +
    `Rename the file under ${colors.yellow('public/')}, or move it to a ` +
    `subfolder that no generated page uses.`
  )
}

export function devOnlyEntriesLeftOut(relativePaths: string[]) {
  const one = relativePaths.length === 1
  const list = relativePaths
    .map((entry) => `  ${colors.yellow(entry)}`)
    .join('\n')

  return (
    `${prefix('debug')} Left ${relativePaths.length} development-only ` +
    `${one ? 'entry' : 'entries'} out of the production build ` +
    `(a ${colors.yellow('.dev.')} file in pages/ or scripts/):\n${list}`
  )
}

export function excludedEntriesLeftOut(relativePaths: string[]) {
  const one = relativePaths.length === 1
  const list = relativePaths
    .map((entry) => `  ${colors.yellow(entry)}`)
    .join('\n')

  return (
    `${prefix('debug')} Left ${relativePaths.length} ` +
    `${one ? 'entry' : 'entries'} out of the build, ` +
    `${colors.blue('exclude')} in extension.config.js names ${one ? 'it' : 'them'}:\n${list}`
  )
}

export function excludeEntryMissing(entry: string, browser: string) {
  return (
    `${colors.blue('exclude')} in extension.config.js names ` +
    `${colors.yellow(entry)}, and no such file is in the project.\n` +
    `Nothing is left out of the ${colors.blue(browser)} build for it. ` +
    'Fix the path, or remove the entry.'
  )
}

export function manifestNamesExcludedFile(
  relativePath: string,
  browser: string
) {
  return (
    `manifest.json names ${colors.yellow(relativePath)}, and ` +
    `${colors.blue('exclude')} in extension.config.js leaves that file ` +
    `out of the ${colors.blue(browser)} build.\n` +
    'The reference would answer 404, so the build stops here. Scope the ' +
    `manifest key to the browsers that ship the file (a ${colors.yellow('chromium:')}, ` +
    `${colors.yellow('gecko:')} or ${colors.yellow('safari:')} prefix), or remove the file from exclude.`
  )
}

export function includeSourceMissing(
  outputPath: string,
  sourcePath: string,
  projectRoot: string
) {
  return (
    `${colors.blue('include')} in extension.config.js maps ` +
    `${colors.yellow(outputPath)} to a file that is not there.\n` +
    `SOURCE ${displayPath(sourcePath, projectRoot)}\n` +
    'Add the file, fix the path, or remove the entry.'
  )
}

export function includeOutputPathInvalid(outputPath: string, reason: string) {
  return (
    `${colors.blue('include')} in extension.config.js cannot write ` +
    `${colors.yellow(outputPath)}: ${reason}.\n` +
    'Each key is an output path relative to the extension root, ' +
    `such as ${colors.blue('models/x.onnx')}.`
  )
}

// Plain on purpose: the same four lines are printed where no browser runs.
export function scannedCompanionOutsideProject(entry: string, target: string) {
  return [
    'A companion extension entry leads outside the project, so it is not loaded.',
    `ENTRY ${entry}`,
    `LEADS TO ${target}`,
    'Companion extensions must be inside the project. Copy the folder into the project, or remove the link.'
  ].join('\n')
}

// One line on purpose: a build has a single place to say it, and the fix is
// one config key whichever of the listed files the project meant to inject.
export function scriptsEntriesOnlyImported(
  relativePaths: string[],
  folder: string
) {
  const one = relativePaths.length === 1
  const list = relativePaths.map((entry) => colors.yellow(entry)).join(', ')
  const value = relativePaths.map((entry) => `'${entry}'`).join(', ')

  return (
    `${list} ${one ? 'is' : 'are'} built as ${one ? 'an entry' : 'entries'} ` +
    `of ${one ? 'its' : 'their'} own because every file in ` +
    `${colors.yellow(folder)} is, yet other files import ` +
    `${one ? 'it' : 'them'} and nothing names ${one ? 'its' : 'their'} output ` +
    `path. For a helper module, add ${colors.blue('exclude')}: ` +
    `${colors.yellow(`[${value}]`)} to extension.config.js. For a script the ` +
    `extension injects, keep it.`
  )
}
