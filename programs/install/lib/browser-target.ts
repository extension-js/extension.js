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

// What `all` expands to, one cache folder each. The CLI keeps a twin of this
// list, MANAGED_INSTALL_BINARIES, and the two must stay equal.
export const ALL_BROWSER_TARGETS: readonly InstallBrowserTarget[] = [
  'chrome',
  'chromium',
  'edge',
  'firefox'
]

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

// Thrown when the Edge installer needs sudo to prompt and the session cannot
// let it. Callers under --output json map this to E_BROWSER_INSTALL_PRIVILEGE,
// which is not a download failure and must not read as one.
export class BrowserInstallPrivilegeError extends Error {
  readonly code = 'BROWSER_INSTALL_PRIVILEGE' as const

  constructor(message: string) {
    super(message)
    this.name = 'BrowserInstallPrivilegeError'
  }
}

export function isBrowserInstallPrivilegeError(
  error: unknown
): error is BrowserInstallPrivilegeError {
  return Boolean(
    error &&
      typeof error === 'object' &&
      ((error as {name?: string}).name === 'BrowserInstallPrivilegeError' ||
        (error as {code?: string}).code === 'BROWSER_INSTALL_PRIVILEGE')
  )
}

// The compile target predates the Error cause option, so cause is assigned.
export function withCause<T extends Error>(error: T, cause: unknown): T {
  if (cause !== undefined) (error as {cause?: unknown}).cause = cause

  return error
}

// Thrown when the package runner the install is handed to is not on this
// machine. Nothing was downloaded, so it must not read as a failed download.
export class BrowserInstallerNotFoundError extends Error {
  readonly code = 'BROWSER_INSTALLER_NOT_FOUND' as const

  constructor(message: string) {
    super(message)
    this.name = 'BrowserInstallerNotFoundError'
  }
}

export function isBrowserInstallerNotFoundError(
  error: unknown
): error is BrowserInstallerNotFoundError {
  return Boolean(
    error &&
      typeof error === 'object' &&
      ((error as {name?: string}).name === 'BrowserInstallerNotFoundError' ||
        (error as {code?: string}).code === 'BROWSER_INSTALLER_NOT_FOUND')
  )
}

function hasIdentity(error: unknown, name: string, code: string): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      ((error as {name?: string}).name === name ||
        (error as {code?: string}).code === code)
  )
}

// Thrown when the installer itself ended badly: a non-zero exit, a signal or
// a download that left no browser. The one failure a retry can fix.
export class BrowserInstallFailedError extends Error {
  readonly code = 'BROWSER_INSTALL_FAILED' as const

  constructor(message: string) {
    super(message)
    this.name = 'BrowserInstallFailedError'
  }
}

export function isBrowserInstallFailedError(
  error: unknown
): error is BrowserInstallFailedError {
  return hasIdentity(
    error,
    'BrowserInstallFailedError',
    'BROWSER_INSTALL_FAILED'
  )
}

// Thrown when the installer was still running at the timeout and was stopped.
export class BrowserInstallTimeoutError extends Error {
  readonly code = 'BROWSER_INSTALL_TIMEOUT' as const
  readonly timeoutMs: number

  constructor(message: string, timeoutMs: number) {
    super(message)
    this.name = 'BrowserInstallTimeoutError'
    this.timeoutMs = timeoutMs
  }
}

export function isBrowserInstallTimeoutError(
  error: unknown
): error is BrowserInstallTimeoutError {
  return hasIdentity(
    error,
    'BrowserInstallTimeoutError',
    'BROWSER_INSTALL_TIMEOUT'
  )
}

// Thrown when another install of the same browser still held the destination
// after the whole wait. Nothing was started and nothing was removed.
export class BrowserInstallBusyError extends Error {
  readonly code = 'BROWSER_INSTALL_BUSY' as const

  constructor(message: string) {
    super(message)
    this.name = 'BrowserInstallBusyError'
  }
}

export function isBrowserInstallBusyError(
  error: unknown
): error is BrowserInstallBusyError {
  return hasIdentity(error, 'BrowserInstallBusyError', 'BROWSER_INSTALL_BUSY')
}

// Thrown when the cache root is a file or cannot be created, before anything
// is downloaded.
export class BrowserCacheRootError extends Error {
  readonly code = 'BROWSER_CACHE_ROOT' as const

  constructor(message: string) {
    super(message)
    this.name = 'BrowserCacheRootError'
  }
}

export function isBrowserCacheRootError(
  error: unknown
): error is BrowserCacheRootError {
  return hasIdentity(error, 'BrowserCacheRootError', 'BROWSER_CACHE_ROOT')
}

// Thrown when the browser folder holds files the installers never write, so
// it may be someone's data. Nothing in it is written or removed.
export class BrowserInstallForeignFolderError extends Error {
  readonly code = 'BROWSER_INSTALL_FOREIGN_FOLDER' as const

  constructor(message: string) {
    super(message)
    this.name = 'BrowserInstallForeignFolderError'
  }
}

export function isBrowserInstallForeignFolderError(
  error: unknown
): error is BrowserInstallForeignFolderError {
  return hasIdentity(
    error,
    'BrowserInstallForeignFolderError',
    'BROWSER_INSTALL_FOREIGN_FOLDER'
  )
}

export type UninstallOutcome = 'removed' | 'absent' | 'system' | 'failed'

// Why a failed folder is still there, for a script to branch on: a removal
// that failed, one this user may not make, a folder that is not ours, or one
// an install is writing to.
export type UninstallFailureKind =
  | 'removal'
  | 'permission'
  | 'foreign'
  | 'installing'

export interface UninstallResult {
  browser: InstallBrowserTarget
  removed: boolean
  // The managed folder that was checked, whatever the outcome.
  path: string
  outcome: UninstallOutcome
  // Set when the outcome is failed: the kind, and the reason in words.
  kind?: UninstallFailureKind
  reason?: string
  // The binary Extension.js leaves alone, when the outcome is system.
  systemPath?: string
}

// Thrown after every target was attempted, so results holds what was removed
// beside what was not. Callers under --output json map it to E_BROWSER_UNINSTALL.
export class BrowserUninstallError extends Error {
  readonly code = 'BROWSER_UNINSTALL' as const
  readonly results: UninstallResult[]

  constructor(message: string, results: UninstallResult[]) {
    super(message)
    this.name = 'BrowserUninstallError'
    this.results = results
  }
}

export function isBrowserUninstallError(
  error: unknown
): error is BrowserUninstallError {
  return Boolean(
    error &&
      typeof error === 'object' &&
      ((error as {name?: string}).name === 'BrowserUninstallError' ||
        (error as {code?: string}).code === 'BROWSER_UNINSTALL')
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
