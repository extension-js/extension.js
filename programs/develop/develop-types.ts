export interface DevOptions {
  mode?: 'development' | 'production' | 'none' | undefined
  browser?: 'chrome' | 'edge' | 'firefox' | 'all'
  port?: number
  noOpen?: boolean
  preferences?: string
  profile?: string
  polyfill?: boolean
  autoReload?: boolean
  stats?: boolean
  startingUrl?: string
  browserFlags?: string[]
  // Deprecated. Use "profile" instead
  userDataDir?: string
}

export interface BuildOptions {
  browser?: 'chrome' | 'edge' | 'firefox' | 'all'
  zipFilename?: string
  zip?: boolean
  zipSource?: boolean
  polyfill?: boolean
}

export interface StartOptions {
  mode?: 'development' | 'production'
  browser?: 'chrome' | 'edge' | 'firefox' | 'all'
  port?: number
  noOpen?: boolean
  preferences?: string
  profile?: string
  // Deprecated. Use "profile" instead
  userDataDir?: string | boolean
  polyfill?: boolean
}

export interface PreviewOptions {
  mode?: 'development' | 'production'
  browser?: 'chrome' | 'edge' | 'firefox' | 'all'
  port?: number
  noOpen?: boolean
  preferences?: string
  profile?: string
  // Deprecated. Use "profile" instead
  userDataDir?: string | boolean
  polyfill?: boolean
}

export interface ThemeIcon {
  light: string
  dark: string
  size?: number
}
