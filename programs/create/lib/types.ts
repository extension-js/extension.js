declare namespace NodeJS {
  interface ProcessEnv {
    EXTENSION_BROWSER:
      | 'chrome'
      | 'edge'
      | 'firefox'
      | 'chromium-based'
      | 'gecko-based'
    EXTENSION_MODE: 'development' | 'production'
    EXTENSION_PUBLIC_BROWSER:
      | 'chrome'
      | 'edge'
      | 'firefox'
      | 'chromium-based'
      | 'gecko-based'
    EXTENSION_PUBLIC_MODE: 'development' | 'production'
    EXTENSION_PUBLIC_DESCRIPTION_TEXT: string
    EXTENSION_PUBLIC_OPENAI_API_KEY: string
    EXTENSION_ENV: 'development' | 'production'
  }
}

interface ImportMetaEnv {
  EXTENSION_BROWSER: NodeJS.ProcessEnv['EXTENSION_BROWSER']
  EXTENSION_MODE: NodeJS.ProcessEnv['EXTENSION_MODE']
  EXTENSION_PUBLIC_BROWSER: NodeJS.ProcessEnv['EXTENSION_BROWSER']
  EXTENSION_PUBLIC_MODE: NodeJS.ProcessEnv['EXTENSION_MODE']
  [key: string]: string | undefined
}

interface ImportMeta {
  readonly env: ImportMetaEnv
  readonly webpackHot?: {
    accept: (module?: string | string[], callback?: () => void) => void
    dispose: (callback: () => void) => void
  }
  url: string
}
