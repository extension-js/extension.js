import {type ManifestBase} from './manifest-types'

export interface HtmlFieldsOutput {
  css: string[]
  js: string[]
  static: string[]
  html: string
  json: string[]
}

export interface ManifestFields {
  html: HtmlFieldsOutput
  icons: string | string[] | {light: string; dark: string}
  json: string | string[]
  locales: string[]
  scripts: string | string[]
  webResources: any
}

export type Manifest = ManifestBase
export type ManifestData = string | string[] | undefined
export type ManifestBrowserThemeIcons =
  | Array<{light: string; dark: string}>
  | undefined
export type ManifestHtmlData =
  | {
      css: string[]
      js: string[]
      static: string[]
      html: string
    }
  | undefined
