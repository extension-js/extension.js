export type BrowsersSupported =
  | 'chrome'
  | 'edge'
  | 'firefox'
  | 'chromium-based'
  | 'gecko-based'
  | 'all'

export interface CreateOptions {
  template?: string
  targetDir?: string
}

export interface DevOptions {
  port?: number
  browser?: BrowsersSupported
}

export interface StartOptions {
  port?: number
  browser?: BrowsersSupported
}

export interface BuildOptions {
  browser?: BrowsersSupported
}
