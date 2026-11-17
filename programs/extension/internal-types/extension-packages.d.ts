declare module 'extension-create' {
  // Renamed templates keep answering to their old names. Declared here only;
  // the table itself lives in extension-create, so there is one list and this
  // shim cannot drift from it in value, only in shape.
  export const TEMPLATE_ALIASES: Readonly<Record<string, string>>
  export function resolveTemplateAlias(name: string): string

  export interface CreateLogger {
    log: (...args: unknown[]) => void
    error: (...args: unknown[]) => void
  }

  export interface CreateOptions {
    template?: string
    install?: boolean
    cliVersion?: string
    logger?: CreateLogger
  }

  export interface CreateResult {
    projectPath: string
    projectName: string
    template: string
    depsInstalled: boolean
    installSeconds?: number
  }

  export function extensionCreate(
    projectNameInput: string | undefined,
    options: CreateOptions
  ): Promise<CreateResult>
}

declare module 'extension-develop' {
  export type BuildOptions = Record<string, unknown>
  export type DevOptions = Record<string, unknown>
  export type PreviewOptions = Record<string, unknown>
  export type FileConfig = Record<string, unknown>
  export type Manifest = Record<string, unknown>

  export function extensionBuild(
    pathOrRemoteUrl: string,
    options: BuildOptions
  ): Promise<unknown>
  export function extensionDev(
    pathOrRemoteUrl: string | undefined,
    options: DevOptions
  ): Promise<unknown>
  export function extensionPreview(
    pathOrRemoteUrl: string | undefined,
    options: PreviewOptions
  ): Promise<unknown>
}

declare module 'extension-develop/preview' {
  export type PreviewOptions = Record<string, unknown>

  export function extensionPreview(
    pathOrRemoteUrl: string | undefined,
    options: PreviewOptions
  ): Promise<unknown>
}

declare module 'extension-install' {
  export interface InstallOptions {
    browser: string
    defaulted?: boolean
    locateInstalledBinary: (
      destination: string,
      browser: 'chrome' | 'chromium' | 'edge' | 'firefox'
    ) => string | null
    systemEdge?: SystemEdgeLookup
  }

  export interface SystemEdgeLookup {
    exists?: (file: string) => boolean
    lookup?: (tool: 'where' | 'which', name: string) => string | null
    registry?: (key: string) => string | null
  }

  export interface UninstallOptions {
    browser?: string
    all?: boolean
    systemEdge?: SystemEdgeLookup
  }

  export interface UninstallResult {
    browser: string
    removed: boolean
    path: string
    outcome: 'removed' | 'absent' | 'system' | 'failed'
    reason?: string
    systemPath?: string
  }

  export class BrowserNotInstallableError extends Error {
    constructor(message: string)
    readonly code: 'BROWSER_NOT_INSTALLABLE'
  }

  export class BrowserInstallPrivilegeError extends Error {
    constructor(message: string)
    readonly code: 'BROWSER_INSTALL_PRIVILEGE'
  }

  export class BrowserInstallerNotFoundError extends Error {
    constructor(message: string)
    readonly code: 'BROWSER_INSTALLER_NOT_FOUND'
  }

  export class BrowserInstallFailedError extends Error {
    constructor(message: string)
    readonly code: 'BROWSER_INSTALL_FAILED'
  }

  export class BrowserInstallTimeoutError extends Error {
    constructor(message: string, timeoutMs: number)
    readonly code: 'BROWSER_INSTALL_TIMEOUT'
    readonly timeoutMs: number
  }

  export class BrowserInstallBusyError extends Error {
    constructor(message: string)
    readonly code: 'BROWSER_INSTALL_BUSY'
  }

  export class BrowserCacheRootError extends Error {
    constructor(message: string)
    readonly code: 'BROWSER_CACHE_ROOT'
  }

  export class BrowserInstallForeignFolderError extends Error {
    constructor(message: string)
    readonly code: 'BROWSER_INSTALL_FOREIGN_FOLDER'
  }

  export class BrowserUninstallError extends Error {
    constructor(message: string, results: UninstallResult[])
    readonly code: 'BROWSER_UNINSTALL'
    readonly results: UninstallResult[]
  }

  export function isBrowserNotInstallableError(
    error: unknown
  ): error is BrowserNotInstallableError
  export function isBrowserInstallPrivilegeError(
    error: unknown
  ): error is BrowserInstallPrivilegeError
  export function isBrowserInstallerNotFoundError(
    error: unknown
  ): error is BrowserInstallerNotFoundError
  export function isBrowserInstallFailedError(
    error: unknown
  ): error is BrowserInstallFailedError
  export function isBrowserInstallTimeoutError(
    error: unknown
  ): error is BrowserInstallTimeoutError
  export function isBrowserInstallBusyError(
    error: unknown
  ): error is BrowserInstallBusyError
  export function isBrowserCacheRootError(
    error: unknown
  ): error is BrowserCacheRootError
  export function isBrowserInstallForeignFolderError(
    error: unknown
  ): error is BrowserInstallForeignFolderError
  export function getManagedBrowsersCacheRoot(): string
  export function getManagedBrowserInstallDir(browser: string): string
  export function extensionInstall(options: InstallOptions): Promise<void>
  export function extensionUninstall(
    options: UninstallOptions
  ): Promise<UninstallResult[]>
}
