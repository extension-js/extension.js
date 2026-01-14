//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

declare module 'extension-develop' {
  // These types mirror the public surface of programs/develop/module.ts,
  // but are intentionally loose on the CLI side. The real, precise types
  // come from the installed `extension-develop` package when consumers
  // depend on it directly.

  export type ExtensionBrowser =
    | 'chrome'
    | 'edge'
    | 'firefox'
    | 'chromium'
    | 'chromium-based'
    | 'gecko-based'
    | 'firefox-based'

  export type ExtensionMode = 'development' | 'production'

  export interface BuildOptions {
    browser?: ExtensionBrowser | 'all'
    polyfill?: boolean
    zip?: boolean
    zipSource?: boolean
    zipFilename?: string
    silent?: boolean
  }

  export interface DevOptions {
    browser?: ExtensionBrowser | 'all'
    profile?: string | boolean
    persistProfile?: boolean
    chromiumBinary?: string
    geckoBinary?: string
    polyfill?: boolean | string
    open?: boolean
    startingUrl?: string
    source?: boolean | string
    watchSource?: boolean
    logLevel?: string
    logFormat?: 'pretty' | 'json'
    logTimestamps?: boolean
    logColor?: boolean
    logUrl?: string
    logTab?: string | number
  }

  export interface PreviewOptions extends DevOptions {}

  export interface StartOptions extends DevOptions {}

  export interface FileConfig {
    [key: string]: unknown
  }

  export interface Manifest {
    [key: string]: unknown
  }

  export function extensionBuild(
    pathOrRemoteUrl: string,
    options: BuildOptions
  ): Promise<any>

  export function extensionDev(
    pathOrRemoteUrl: string,
    options: DevOptions
  ): Promise<any>

  export function extensionStart(
    pathOrRemoteUrl: string,
    options: StartOptions
  ): Promise<any>

  export function extensionPreview(
    pathOrRemoteUrl: string,
    options: PreviewOptions
  ): Promise<any>
}
