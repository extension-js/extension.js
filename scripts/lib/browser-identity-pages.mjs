// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

export function ownExtensionIds(ready) {
  const ids = new Set()
  if (typeof ready?.extensionId === 'string') ids.add(ready.extensionId)

  for (const managed of Array.isArray(ready?.managedExtensions)
    ? ready.managedExtensions
    : []) {
    if (typeof managed?.id === 'string' && managed.id) ids.add(managed.id)
  }

  return ids
}

// What the browser put on screen. A page is ours when it belongs to the user
// extension or a companion the session loaded, or when it is the engine's own
// blank surface. Anything else in front of a reader on a fresh profile is a
// fork's onboarding: Zen's import wizard, Floorp's release notes, Vivaldi's
// signup wizard (a chrome-extension:// page of Vivaldi's own UI, which is why
// the check compares ids and never trusts the scheme).
export const ENGINE_BLANK_PAGES = [
  /^about:(blank|newtab|home|privatebrowsing)$/,
  // newtab-footer is a companion surface of the new tab page, not a page
  // competing for the reader: system Chromium 146 exposes it as its own target
  // while managed Chrome 151 does not, and it failed the check on that alone.
  /^chrome:\/\/(newtab|newtab-footer|new-tab-page|extensions|startpage|startpageshared)\/?$/,
  /^edge:\/\/(newtab|extensions)\/?$/,
  /^moz-extension:\/\//
]

export function isOwnPage(url, ownIds) {
  const text = String(url || '')
  const extension = /^chrome-extension:\/\/([a-p]{32})\//.exec(text)
  if (extension) return ownIds.has(extension[1])

  return /^moz-extension:\/\//.test(text)
}

export function isOwnOrBlankPage(url, ownIds) {
  const text = String(url || '')
  if (!text) return true

  const extension = /^chrome-extension:\/\/([a-p]{32})\//.exec(text)
  if (extension) return ownIds.has(extension[1])

  return ENGINE_BLANK_PAGES.some((pattern) => pattern.test(text))
}

// A Chromium session whose contract never got its port still debugs on the
// one in its argv, so the page listing has a second place to read it from.
export function debugPortFromArgv(argvText) {
  const match = /(?:^|\s)--remote-debugging-port=(\d+)(?=\s|$)/.exec(
    String(argvText || '')
  )
  const port = match ? Number(match[1]) : 0

  return port > 0 ? port : null
}
