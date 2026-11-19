//  ██████╗ ██████╗ ███╗   ███╗██████╗ ██╗██╗      █████╗ ████████╗██╗ ██████╗ ███╗   ██╗
// ██╔════╝██╔═══██╗████╗ ████║██╔══██╗██║██║     ██╔══██╗╚══██╔══╝██║██╔═══██╗████╗  ██║
// ██║     ██║   ██║██╔████╔██║██████╔╝██║██║     ███████║   ██║   ██║██║   ██║██╔██╗ ██║
// ██║     ██║   ██║██║╚██╔╝██║██╔═══╝ ██║██║     ██╔══██║   ██║   ██║██║   ██║██║╚██╗██║
// ╚██████╗╚██████╔╝██║ ╚═╝ ██║██║     ██║███████╗██║  ██║   ██║   ██║╚██████╔╝██║ ╚████║
//  ╚═════╝ ╚═════╝ ╚═╝     ╚═╝╚═╝     ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚═╝ ╚═════╝ ╚═╝  ╚═══╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import colors from 'pintor'
import {prefix} from '../../lib/messaging'
import {displayPath} from '../../lib/paths'

export interface CompileReport {
  errors: number
  warnings: number
  // Where the warnings print relative to this line, unset when it follows them.
  warningsListed?: 'below' | 'above and below'
}

const counted = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? '' : 's'}`

export function boring(
  manifestName: string,
  durationMs: number,
  report: CompileReport
) {
  const now = new Date()
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const ss = String(now.getSeconds()).padStart(2, '0')
  const timestamp = colors.gray(`[${hh}:${mm}:${ss}]`)

  const {errors, warnings, warningsListed} = report

  // One glyph across all five channels; the color carries the severity.
  const arrow =
    errors > 0
      ? prefix('error', 'Error')
      : warnings > 0
        ? prefix('warn', 'Warning')
        : prefix('info')
  const time = `${durationMs} ms`

  // A failed compile never reads as one that went through.
  if (errors > 0) {
    const also =
      warnings > 0 ? ` and ${colors.yellow(counted(warnings, 'warning'))}` : ''
    const status = `failed to compile ${colors.red(
      `with ${counted(errors, 'error')}`
    )}${also}`

    return `${arrow} ${timestamp} ${manifestName} ${status} in ${time}.`
  }

  if (warnings > 0) {
    const status = `compiled ${colors.yellow(
      `with ${counted(warnings, 'warning')}`
    )}`
    const where = warningsListed ? `, listed ${warningsListed}` : ''

    return `${arrow} ${timestamp} ${manifestName} ${status} in ${time}${where}.`
  }

  return `${arrow} ${timestamp} ${manifestName} compiled in ${time}.`
}

export function zipMissingDefaultLocale(
  defaultLocale: string,
  messagesPath: string
) {
  return (
    `ZipPlugin: manifest.json declares default_locale "${defaultLocale}" ` +
    `but ${messagesPath} does not exist. Stores reject packages ` +
    `without their default locale: restore the _locales folder ` +
    `before shipping this zip.`
  )
}

// A folder left out is named, so a source folder that shares the session
// folder's name is never dropped without a word.
export function zipLeftOutSessionFolders(
  kind: 'source' | 'dist',
  folders: string[]
) {
  const one = folders.length === 1
  const archive = kind === 'source' ? 'source zip' : 'extension zip'

  return (
    `${prefix('warn')} The ${archive} left out ${one ? 'a folder' : `${folders.length} folders`} that Extension.js writes while it builds and runs, not part of the extension.\n` +
    `${colors.gray('LEFT OUT')} ${folders.join(', ')}\n` +
    `Delete ${one ? 'it' : 'them'} while no session is running.` +
    (kind === 'source'
      ? ' A folder of your own named extension-js is packed once it holds a package.json.'
      : '')
  )
}

type ZipLeftOutReason = 'key' | 'registry' | 'archive' | 'build' | 'env'

const ZIP_LEFT_OUT: Record<ZipLeftOutReason, {label: string; why: string}> = {
  key: {
    label: 'KEY FILE',
    why: 'A signing key or a packed extension is never source.'
  },
  registry: {
    label: 'REGISTRY AUTH',
    why: `A registry file is packed once its auth value reads the environment, as in \${NPM_TOKEN}.`
  },
  archive: {
    label: 'OLD ARCHIVE',
    why: 'An archive of an earlier run is not packed into a new one.'
  },
  build: {
    label: 'BUILD OUTPUT',
    why: 'A folder named after a browser inside dist or build that holds a manifest.json is a build.'
  },
  env: {
    label: 'ENV FILE',
    why: 'An env file reaches the output from the public folder. Move it out of there.'
  }
}

// Names the path and the reason, never what a file holds.
export function zipLeftOut(
  kind: 'source' | 'dist',
  entries: Array<{reason: ZipLeftOutReason; path: string}>
) {
  const reasons = (Object.keys(ZIP_LEFT_OUT) as ZipLeftOutReason[]).filter(
    (reason) => entries.some((entry) => entry.reason === reason)
  )
  const lines = reasons.map((reason) => {
    // Sorted here: the walk lists a folder in the order its file system
    // gives, which differs where names differ only by case.
    const paths = entries
      .filter((entry) => entry.reason === reason)
      .map((entry) => entry.path)
      .sort()

    return `${colors.gray(ZIP_LEFT_OUT[reason].label)} ${paths.join(', ')}\n`
  })

  return (
    `${prefix('warn')} The ${kind === 'source' ? 'source zip left out what is not source' : 'extension zip left out what is not part of the extension'}.\n` +
    lines.join('') +
    reasons.map((reason) => ZIP_LEFT_OUT[reason].why).join(' ')
  )
}

export function zipSourceEmpty() {
  return `${prefix('warn')} The source zip holds no files. Every file in the project is ignored or left out.`
}

export function zipCreationFailed(error: unknown) {
  return `ZipPlugin: Failed to create zip(s): ${String(error)}`
}

export function zipPackagingSkipped(reason: string) {
  return `${prefix('debug')} zip      skipped=true reason="${reason}"`
}

// Weakest first, the order the files are merged in.
export function envSelectedFile(envPaths: string[]) {
  return `${prefix('debug')} env      files=${envPaths.join(',') || 'none'}`
}

export function envInjectedPublicVars(count: number) {
  return `${prefix('debug')} env      injected=${count} prefix=EXTENSION_PUBLIC_`
}

export function envValueBreaksJsonAsset(asset: string, names: string[]) {
  return (
    `${colors.yellow(asset)} is not valid JSON after substituting ` +
    `${names.map((name) => colors.yellow(`$${name}`)).join(', ')}.\n` +
    `Quote the placeholder to get a JSON string: ${colors.gray(`"$${names[0]}"`)}. ` +
    `An unquoted placeholder takes the value as written, so the value must be JSON itself.`
  )
}

// A live session cannot re-read the config file: the loader caches it and the
// merged options are a session-scoped snapshot. Say so instead of compiling
// clean and leaving the author to wonder which build their edit landed in.
export function projectConfigChangedRestartRequired(configPath: string) {
  return (
    `${colors.yellow(displayPath(configPath))} changed. This session keeps ` +
    `running the config it read at startup.\n` +
    `Stop it and run ${colors.blue('extension dev')} again to apply the change.`
  )
}

// The fallback for a watch run with no dev session to restart, where the
// values this build inlined stay the ones read when the compiler was created.
export function envChangedRestartRequired(envPath: string) {
  return (
    `${colors.yellow(displayPath(envPath))} changed. The values this build ` +
    `inlined are the ones read when the compiler started.\n` +
    `Restart the dev server to apply the change.`
  )
}

export function envPublicSecretName(names: string[]) {
  const one = names.length === 1

  return (
    `${names.map((name) => colors.yellow(name)).join(', ')} ` +
    `${one ? 'looks' : 'look'} like ${one ? 'a secret' : 'secrets'}, and every ` +
    `${colors.yellow('EXTENSION_PUBLIC_*')} value is written into the built ` +
    `JavaScript that every user and every store review can read.\n` +
    `Keep the secret on a server the extension calls, under a name without the ` +
    `${colors.yellow('EXTENSION_PUBLIC_')} prefix. If the value is public by ` +
    `design, such as a Firebase web API key, this warning does not apply to it.`
  )
}

// Names the placeholder and the asset, never the value it would have written.
export function envPrivatePlaceholder(
  placeholders: Array<{name: string; assets: string[]}>
) {
  const example = placeholders[0].name.replace(
    /^EXTENSION_/,
    'EXTENSION_PUBLIC_'
  )

  return (
    placeholders
      .map(
        ({name, assets}) =>
          `${colors.yellow(`$${name}`)} in ` +
          `${assets.map((asset) => colors.yellow(asset)).join(', ')} ` +
          `was left as written.\n`
      )
      .join('') +
    `Placeholders in emitted .json and .html files are filled only from ` +
    `${colors.yellow('EXTENSION_PUBLIC_*')} variables, because those files ` +
    `ship to every user.\n` +
    `If the value is meant to ship, rename the variable with that prefix, ` +
    `such as ${colors.yellow(example)}.`
  )
}

// Names the variable and the file, never the value the file gave it.
export function envReservedName(entries: Array<{name: string; file: string}>) {
  return (
    entries
      .map(
        ({name, file}) =>
          `${colors.yellow(name)} in ${colors.yellow(file)} is reserved for ` +
          `the build target, so the file value is ignored.\n`
      )
      .join('') +
    `The build sets the browser and mode names itself, from the target it ` +
    `compiles for. Use another name for a value of your own.`
  )
}

export function envIgnoredFiles(files: string[], mode: string) {
  return `${prefix('debug')} env      ignored=${files.join(',')} mode=${mode}`
}

export function envNoMatchingFile(
  browser: string,
  mode: string,
  presentFiles: string[],
  expectedCandidates: string[],
  publicValuesDefined = false
) {
  const undefinedLine = publicValuesDefined
    ? ''
    : `EXTENSION_PUBLIC_* variables read from code are ` +
      `${colors.yellow('undefined')} in this build.\n`

  return (
    `Found ${presentFiles.map((file) => colors.yellow(file)).join(', ')}, ` +
    `but none match browser ${colors.yellow(browser)} in mode ${colors.yellow(
      mode
    )}.\n` +
    undefinedLine +
    `Rename the file to one of these, in priority order: ` +
    `${expectedCandidates.map((file) => colors.gray(file)).join(', ')}.\n` +
    `Family names apply to every family member, so ` +
    `${colors.yellow('.env.chrome')} also matches ${colors.yellow(
      'chromium'
    )} and ${colors.yellow('edge')} targets.`
  )
}

// Shared by the build error and the require() warning, so both name one fix.
export function nodeBuiltinStandInHint(builtin: string) {
  const root = builtin.split('/')[0]

  return (
    `In ${colors.yellow('extension.config.js')}, set ` +
    `${colors.yellow('resolve.fallback')} from the ` +
    `${colors.yellow('config')} hook: ` +
    `${colors.yellow(`{'${root}': false}`)} for an empty module, or the path ` +
    `of a browser polyfill you installed, such as ` +
    `${colors.yellow(`require.resolve('${root}/')`)}. ` +
    `${colors.yellow(`node:${root}`)} and ${colors.yellow(root)} read the ` +
    `same key.`
  )
}

// The upstream text stops at "Can't resolve 'util'", which reads as a missing
// dependency. It is a Node module, and the answer is a key in the config file.
export function nodeBuiltinHasNoStandIn(
  builtin: string,
  issuer: string,
  stubbed: readonly string[],
  upstream: string
) {
  const from = issuer
    ? ` ${colors.yellow(displayPath(issuer))} imports it.`
    : ''
  const head =
    `The Node.js built-in ${colors.yellow(builtin)} does not exist in a ` +
    `browser, and this build has no stand-in for it.${from}`

  // A name Node answers only with its prefix has no bare key to fall back on.
  if (builtin.startsWith('node:')) {
    return (
      `${head}\nIt has no bare name, so ` +
      `${colors.yellow('resolve.fallback')} cannot reach it. In ` +
      `${colors.yellow('extension.config.js')}, push ` +
      `${colors.yellow(
        `new rspack.NormalModuleReplacementPlugin(/^${builtin}$/, yourModulePath)`
      )} onto ${colors.yellow('config.plugins')} from the ` +
      `${colors.yellow('config')} hook, where ` +
      `${colors.yellow('yourModulePath')} is the absolute path of a module ` +
      `of yours. The hook's second argument carries the class: ` +
      `${colors.yellow('config: (config, {rspack}) => config')}.`
    )
  }

  const stubs =
    stubbed.length > 0
      ? `Only ${stubbed.map((name) => colors.yellow(name)).join(', ')} ` +
        `${stubbed.length === 1 ? 'is' : 'are'} replaced with an empty module. `
      : ''

  return `${head}\n${stubs}${nodeBuiltinStandInHint(builtin)}\n${upstream}`
}

// A require() the bundler could not resolve, left verbatim in the output.
export function unresolvedBareRequire(
  request: string,
  issuer: string,
  builtin: string | undefined
) {
  return (
    `require('${request}')${issuer ? ` in ${issuer}` : ''} does not ` +
    `resolve to any module, so the call is left verbatim in the output. ` +
    `Chrome loads the script anyway. It only throws if that code path ` +
    `runs (vendored pre-bundled libraries often carry dead require() ` +
    `branches). ` +
    (builtin
      ? `It names a Node.js built-in. ` +
        `${nodeBuiltinStandInHint(builtin)} Or set `
      : `Install the package if it's a real dependency, or set `) +
    `EXTENSION_STRICT_REFS=true to make this fail the build.`
  )
}
