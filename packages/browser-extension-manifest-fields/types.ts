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

export type ManifestData = Record<string, any | any[]>
