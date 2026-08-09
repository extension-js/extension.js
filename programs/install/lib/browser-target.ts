//  ██╗███╗   ██╗███████╗████████╗ █████╗ ██╗     ██╗
//  ██║████╗  ██║██╔════╝╚══██╔══╝██╔══██╗██║     ██║
//  ██║██╔██╗ ██║███████╗   ██║   ███████║██║     ██║
//  ██║██║╚██╗██║╚════██║   ██║   ██╔══██║██║     ██║
//  ██║██║ ╚████║███████║   ██║   ██║  ██║███████╗███████╗
//  ╚═╝╚═╝  ╚═══╝╚══════╝   ╚═╝   ╚═╝  ╚═╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

export type InstallBrowserTarget = 'chrome' | 'chromium' | 'edge' | 'firefox'

// Exported for the cross-package taxonomy contract spec: these keys and the
// CLI's MANAGED_INSTALL_TARGETS are hand-synced twins and must stay equal.
export const BROWSER_ALIASES: Record<string, InstallBrowserTarget> = {
  chrome: 'chrome',
  chromium: 'chromium',
  edge: 'edge',
  firefox: 'firefox',
  'chromium-based': 'chromium',
  'gecko-based': 'firefox',
  'firefox-based': 'firefox'
}

// Thrown when a vendor is known to the CLI (or any other name) but has no
// managed install path. Callers under --output json map this to
// E_BROWSER_NOT_INSTALLABLE so path discovery never escapes as a raw stack.
export class BrowserNotInstallableError extends Error {
  readonly code = 'BROWSER_NOT_INSTALLABLE' as const

  constructor(message: string) {
    super(message)
    this.name = 'BrowserNotInstallableError'
  }
}

// Name-based so the check still works when the install package is loaded from
// a different module instance than the CLI that catches the error.
export function isBrowserNotInstallableError(
  error: unknown
): error is BrowserNotInstallableError {
  return Boolean(
    error &&
      typeof error === 'object' &&
      ((error as {name?: string}).name === 'BrowserNotInstallableError' ||
        (error as {code?: string}).code === 'BROWSER_NOT_INSTALLABLE')
  )
}

export function normalizeBrowserName(input: string): InstallBrowserTarget {
  const value = String(input || '')
    .trim()
    .toLowerCase()
  const resolved = BROWSER_ALIASES[value]

  if (resolved) return resolved

  // Entire webkit family (safari, webkit-based, and webkit-flavored forks).
  if (
    value === 'safari' ||
    value === 'webkit-based' ||
    value.includes('webkit') ||
    value.includes('safari')
  ) {
    throw new BrowserNotInstallableError(
      `There is no Safari binary to install. Safari ships with macOS. ` +
        `Safari builds need the full Xcode app instead (Mac App Store), then ` +
        `run \`extension build --browser safari\`.`
    )
  }

  // Known forks (brave/opera/…) and any other non-managed name share this
  // type so callers can map to E_BROWSER_NOT_INSTALLABLE; the CLI classifies
  // true unknowns separately before reaching here.
  throw new BrowserNotInstallableError(
    `${value} cannot be installed by Extension.js. ` +
      `This CLI never downloads it; it is located from the system when present. ` +
      `Managed installs cover: ${Object.keys(BROWSER_ALIASES).join(', ')}.`
  )
}
