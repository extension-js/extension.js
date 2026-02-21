// Internal CLI type shims to avoid build-time workspace dependency on compiled
// extension-create/extension-develop types. These are not published.

declare module 'extension-create' {
  export interface CreateOptions {
    template: string
    install?: boolean
    cliVersion?: string
  }

  export function extensionCreate(
    projectNameInput: string | undefined,
    options: CreateOptions
  ): Promise<void>
}

declare module 'extension-develop' {
  export type BuildOptions = Record<string, unknown>
  export type DevOptions = Record<string, unknown>
  export type PreviewOptions = Record<string, unknown>
  export type StartOptions = Record<string, unknown>
  export type FileConfig = Record<string, unknown>
  export type Manifest = Record<string, unknown>

  export function extensionBuild(
    pathOrRemoteUrl: string,
    options: BuildOptions
  ): Promise<any>
  export function extensionDev(
    pathOrRemoteUrl: string | undefined,
    options: DevOptions
  ): Promise<any>
  export function extensionPreview(
    pathOrRemoteUrl: string | undefined,
    options: PreviewOptions
  ): Promise<any>
  export function extensionStart(
    pathOrRemoteUrl: string | undefined,
    options: StartOptions
  ): Promise<any>
  export function ensureDependencies(
    pathOrRemoteUrl: string | undefined
  ): Promise<void>
}

declare module 'extension-install' {
  export interface InstallOptions {
    browser: string
  }

  export interface UninstallOptions {
    browser?: string
    all?: boolean
  }

  export function getManagedBrowsersCacheRoot(): string
  export function getManagedBrowserInstallDir(browser: string): string
  export function extensionInstall(options: InstallOptions): Promise<void>
  export function extensionUninstall(options: UninstallOptions): Promise<void>
}
