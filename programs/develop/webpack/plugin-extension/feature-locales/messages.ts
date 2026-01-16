// ██╗      ██████╗  ██████╗ █████╗ ██╗     ███████╗███████╗
// ██║     ██╔═══██╗██╔════╝██╔══██╗██║     ██╔════╝██╔════╝
// ██║     ██║   ██║██║     ███████║██║     █████╗  ███████╗
// ██║     ██║   ██║██║     ██╔══██║██║     ██╔══╝  ╚════██║
// ███████╗╚██████╔╝╚██████╗██║  ██║███████╗███████╗███████║
// ╚══════╝ ╚═════╝  ╚═════╝╚═╝  ╚═╝╚══════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

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
  return 'default_locale is set, but the _locales folder is missing. Add _locales/<default>/messages.json.'
}

export function defaultLocaleFolderMissing(defaultLocale: string) {
  return `Default locale folder is missing: _locales/${defaultLocale}. Create it and add messages.json.`
}

export function defaultLocaleMessagesMissing(defaultLocale: string) {
  return `Default locale messages.json is missing: _locales/${defaultLocale}/messages.json. Create the file with your strings.`
}

export function localesPresentButNoDefaultLocale() {
  return 'The _locales folder exists, but manifest.json is missing default_locale. Add default_locale to manifest.json.'
}

export function invalidMessagesJson(absPath: string) {
  return `Invalid JSON in locale messages file: ${absPath}. Fix the JSON syntax and try again.`
}

export function missingManifestMessageKey(key: string, defaultLocale?: string) {
  const header = 'Check the i18n placeholders in your manifest.json file.'
  const localePath = defaultLocale
    ? `_locales/${defaultLocale}/messages.json`
    : '_locales/<default>/messages.json'
  const guidance = `The key "${key}" referenced via __MSG_${key}__ must be defined in ${localePath}. Add the key to that file.`
  const final = `MISSING KEY ${key} in ${localePath}`

  return `${header}\n${guidance}\n\n${final}`
}

export function localesIncludeSummary(
  hasManifest: boolean,
  hasLocalesRoot: boolean,
  defaultLocale?: string
) {
  const dl = defaultLocale
    ? `default_locale=${defaultLocale}`
    : 'default_locale=<none>'
  return `Locales include summary — manifest=${String(hasManifest)}, localesRoot=${String(hasLocalesRoot)}, ${dl}`
}

export function localesEmitSummary(
  emitted: number,
  missing: number,
  discovered: number
) {
  return `Locales emitted=${String(emitted)}, missing=${String(missing)}, discovered=${String(discovered)}`
}

export function localesDepsTracked(addedCount: number) {
  return `Locales file dependencies tracked: ${String(addedCount)}`
}

export function localesValidationDetected(issue: string) {
  return `Locales validation detected: ${issue}`
}
