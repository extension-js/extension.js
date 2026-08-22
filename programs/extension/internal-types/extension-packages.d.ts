// Internal CLI type shims to avoid build-time workspace dependency on compiled
// extension-create/extension-develop types. These are not published.

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
  }

  export interface UninstallOptions {
    browser?: string
    all?: boolean
  }

  export class BrowserNotInstallableError extends Error {
    readonly code: 'BROWSER_NOT_INSTALLABLE'
  }

  export function isBrowserNotInstallableError(
    error: unknown
  ): error is BrowserNotInstallableError
  export function getManagedBrowsersCacheRoot(): string
  export function getManagedBrowserInstallDir(browser: string): string
  export function extensionInstall(options: InstallOptions): Promise<void>
  export function extensionUninstall(options: UninstallOptions): Promise<void>
}
