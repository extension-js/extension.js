// ██╗      ██████╗  ██████╗ █████╗ ██╗     ███████╗███████╗
// ██║     ██╔═══██╗██╔════╝██╔══██╗██║     ██╔════╝██╔════╝
// ██║     ██║   ██║██║     ███████║██║     █████╗  ███████╗
// ██║     ██║   ██║██║     ██╔══██║██║     ██╔══╝  ╚════██║
// ███████╗╚██████╔╝╚██████╗██║  ██║███████╗███████╗███████║
// ╚══════╝ ╚═════╝  ╚═════╝╚═╝  ╚═╝╚══════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {prefix} from '../../lib/messaging'

export function manifestNotFoundMessageOnly(absPath: string) {
  return (
    `Can't find a manifest.json file.\n` +
    `NOT FOUND ${absPath}\n` +
    `Add a manifest.json file to your project root.`
  )
}

export function entryNotFoundMessageOnly(
  manifestField: string,
  absPath?: string
) {
  const lines = [`Can't find the file listed in ${manifestField}.`]
  if (absPath) lines.push(`NOT FOUND ${absPath}`)
  lines.push(`Update the ${manifestField} field in your manifest.json file.`)
  return lines.join('\n')
}

// The following messages intentionally avoid color/ANSI so unit tests and CLI output remain clean
export function defaultLocaleSpecifiedButLocalesMissing() {
  return (
    'default_locale is set, but the _locales folder is missing.\n' +
    'Add _locales/<default>/messages.json.'
  )
}

export function defaultLocaleFolderMissing(defaultLocale: string) {
  return (
    `The default locale folder is missing.\n` +
    `NOT FOUND _locales/${defaultLocale}\n` +
    'Create the folder and add a messages.json file.'
  )
}

export function defaultLocaleMessagesMissing(defaultLocale: string) {
  return (
    `The default locale messages.json file is missing.\n` +
    `NOT FOUND _locales/${defaultLocale}/messages.json\n` +
    'Create the file with your strings.'
  )
}

export function localesPresentButNoDefaultLocale() {
  return (
    'The _locales folder exists, but manifest.json is missing default_locale.\n' +
    'Add default_locale to manifest.json.'
  )
}

export function invalidMessagesJson(absPath: string) {
  return (
    `Can't parse a locale messages.json file.\n` +
    `PATH ${absPath}\n` +
    'Fix the JSON syntax and try again.'
  )
}

export function missingManifestMessageKey(key: string, defaultLocale?: string) {
  const localePath = defaultLocale
    ? `_locales/${defaultLocale}/messages.json`
    : '_locales/<default>/messages.json'
  return (
    `The manifest references __MSG_${key}__, but the key "${key}" isn't defined.\n` +
    `NOT FOUND ${key}\n` +
    `PATH ${localePath}\n` +
    `Add the key to the messages file.`
  )
}

export function localesIncludeSummary(
  hasManifest: boolean,
  hasLocalesRoot: boolean,
  defaultLocale?: string
) {
  const dl = defaultLocale || 'none'
  return (
    `${prefix('debug')} locales  include manifest=${String(hasManifest)} ` +
    `root=${String(hasLocalesRoot)} default_locale=${dl}`
  )
}

export function localesEmitSummary(
  emitted: number,
  missing: number,
  discovered: number
) {
  return (
    `${prefix('debug')} locales  emitted=${String(emitted)} ` +
    `missing=${String(missing)} discovered=${String(discovered)}`
  )
}

export function localesDepsTracked(addedCount: number) {
  return `${prefix('debug')} locales  deps=${String(addedCount)}`
}

export function localesValidationDetected(issue: string) {
  return `${prefix('debug')} locales  validation="${issue}"`
}

export function localesMustBeAtProjectRoot(
  foundAt: string,
  expectedAt: string
) {
  return (
    'The _locales folder sits in the legacy next-to-manifest location.\n' +
    `GOT ${foundAt}\n` +
    `EXPECTED ${expectedAt}\n` +
    'Chrome reads locales from the extension root, so _locales/ is ' +
    'canonically placed at the project root.\n' +
    'The build uses it either way.\n' +
    'Move the folder to the project root to silence this warning.'
  )
}
