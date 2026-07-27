// ██╗      ██████╗  ██████╗ █████╗ ██╗     ███████╗███████╗
// ██║     ██╔═══██╗██╔════╝██╔══██╗██║     ██╔════╝██╔════╝
// ██║     ██║   ██║██║     ███████║██║     █████╗  ███████╗
// ██║     ██║   ██║██║     ██╔══██║██║     ██╔══╝  ╚════██║
// ███████╗╚██████╔╝╚██████╗██║  ██║███████╗███████╗███████║
// ╚══════╝ ╚═════╝  ╚═════╝╚═╝  ╚═╝╚══════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {prefix} from '../../lib/messaging'

export function manifestNotFoundMessageOnly(absPath: string) {
  return `Check for a valid manifest.json file.\n\nNOT FOUND ${absPath}`
}

export function entryNotFoundMessageOnly(
  manifestField: string,
  absPath?: string
) {
  const guidance = `Check the ${manifestField} field in your manifest.json file.`
  const suffix = absPath ? `\n\nNOT FOUND ${absPath}` : ''
  return guidance + suffix
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
    `Default locale folder is missing: _locales/${defaultLocale}.\n` +
    'Create it and add messages.json.'
  )
}

export function defaultLocaleMessagesMissing(defaultLocale: string) {
  return (
    `Default locale messages.json is missing: _locales/${defaultLocale}/messages.json.\n` +
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
    `Invalid JSON in locale messages file: ${absPath}.\n` +
    'Fix the JSON syntax and try again.'
  )
}

export function missingManifestMessageKey(key: string, defaultLocale?: string) {
  const header = 'Check the i18n placeholders in your manifest.json file.'
  const localePath = defaultLocale
    ? `_locales/${defaultLocale}/messages.json`
    : '_locales/<default>/messages.json'
  const guidance =
    `The key "${key}" referenced via __MSG_${key}__ must be defined in ${localePath}.\n` +
    'Add the key to that file.'
  const final = `MISSING KEY ${key} in ${localePath}`

  return `${header}\n${guidance}\n\n${final}`
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
    '_locales/ is canonically placed at the project root, next to ' +
    'package.json, public/ and dist/, because Chrome reads locales from ' +
    'the extension root.\n' +
    'This one sits in the legacy next-to-manifest location.\n' +
    'Move it to the project root to silence this warning.\n' +
    'The build uses it either way.\n\n' +
    `  found:    ${foundAt}\n` +
    `  preferred: ${expectedAt}`
  )
}
