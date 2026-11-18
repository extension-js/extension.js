//  ██████╗ ██████╗ ███╗   ███╗██████╗ ██╗██╗      █████╗ ████████╗██╗ ██████╗ ███╗   ██╗
// ██╔════╝██╔═══██╗████╗ ████║██╔══██╗██║██║     ██╔══██╗╚══██╔══╝██║██╔═══██╗████╗  ██║
// ██║     ██║   ██║██╔████╔██║██████╔╝██║██║     ███████║   ██║   ██║██║   ██║██╔██╗ ██║
// ██║     ██║   ██║██║╚██╔╝██║██╔═══╝ ██║██║     ██╔══██║   ██║   ██║██║   ██║██║╚██╗██║
// ╚██████╗╚██████╔╝██║ ╚═╝ ██║██║     ██║███████╗██║  ██║   ██║   ██║╚██████╔╝██║ ╚████║
//  ╚═════╝ ╚═════╝ ╚═╝     ╚═╝╚═╝     ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚═╝ ╚═════╝ ╚═╝  ╚═══╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {Stats} from '@rspack/core'
import colors from 'pintor'
import {prefix} from '../../lib/messaging'
import {displayPath} from '../../lib/paths'

export function boring(manifestName: string, durationMs: number, stats: Stats) {
  const now = new Date()
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const ss = String(now.getSeconds()).padStart(2, '0')
  const timestamp = colors.gray(`[${hh}:${mm}:${ss}]`)

  const hasErrors = stats.hasErrors()
  const hasWarnings = stats.hasWarnings()

  // One glyph across all five channels; the color carries the severity.
  const arrow = hasErrors
    ? prefix('error')
    : hasWarnings
      ? prefix('warn')
      : prefix('info')
  const status = hasErrors
    ? `compiled ${colors.red('with errors')}`
    : hasWarnings
      ? `compiled ${colors.yellow('with warnings')}`
      : 'compiled'
  const app = manifestName
  const time = `${durationMs} ms`

  return `${arrow} ${timestamp} ${app} ${status} in ${time}.`
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

export function zipCreationFailed(error: unknown) {
  return `ZipPlugin: Failed to create zip(s): ${String(error)}`
}

export function zipPackagingSkipped(reason: string) {
  return `${prefix('debug')} zip      skipped=true reason="${reason}"`
}

export function envSelectedFile(envPath: string) {
  return `${prefix('debug')} env      file=${envPath || 'none'}`
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
