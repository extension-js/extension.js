export function manifestNotFoundMessageOnly(absPath: string) {
  return `Check the manifest.json file.\n\nNOT FOUND ${absPath}`
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
  return 'Default locale was specified, but _locales subtree is missing.'
}

export function defaultLocaleFolderMissing(defaultLocale: string) {
  return `Default locale folder is missing: _locales/${defaultLocale}`
}

export function defaultLocaleMessagesMissing(defaultLocale: string) {
  return `Default locale messages.json is missing: _locales/${defaultLocale}/messages.json`
}

export function localesPresentButNoDefaultLocale() {
  return 'The _locales subtree exists but manifest.json is missing default_locale.'
}

export function invalidMessagesJson(absPath: string) {
  return `Invalid JSON in locale messages file: ${absPath}`
}

export function missingManifestMessageKey(key: string, defaultLocale?: string) {
  const header = 'Check the i18n placeholders in your manifest.json file.'
  const localePath = defaultLocale
    ? `_locales/${defaultLocale}/messages.json`
    : '_locales/<default>/messages.json'
  const guidance = `The key "${key}" referenced via __MSG_${key}__ must be defined in ${localePath}.`
  const final = `MISSING KEY ${key} in ${localePath}`

  return `${header}\n${guidance}\n\n${final}`
}
