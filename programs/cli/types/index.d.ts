/// <reference types="node" />
/// <reference types="chrome" />
/// <reference types="./js-frameworks.d.ts" />
/// <reference path="./css-content.d.ts" />
/// <reference path="./css-modules.d.ts" />
/// <reference path="./images.d.ts" />

type ExtensionBrowser = 'chrome' | 'edge' | 'firefox' | 'chromium-based' | 'gecko-based'
type ExtensionMode = 'development' | 'production'

interface ExtensionEnv {
  EXTENSION_BROWSER: ExtensionBrowser
  EXTENSION_MODE: ExtensionMode
  EXTENSION_PUBLIC_BROWSER: ExtensionBrowser
  EXTENSION_PUBLIC_MODE: ExtensionMode
  EXTENSION_PUBLIC_DESCRIPTION_TEXT: string
  EXTENSION_PUBLIC_OPENAI_API_KEY: string
  EXTENSION_ENV: ExtensionMode
}

declare namespace NodeJS {
  interface ProcessEnv extends ExtensionEnv {
    [key: string]: string | undefined
  }
}

interface ImportMetaEnv extends ExtensionEnv {
  // Remove duplicate index signature since it's already inherited from ExtensionEnv
}

interface ImportMeta {
  readonly env: ImportMetaEnv
  // @ts-expect-error - This is a webpack specific property
  readonly webpackHot?: {
    accept: (module?: string | string[], callback?: () => void) => void
    dispose: (callback: () => void) => void
  }
  url: string
}

interface Window {
  __EXTENSION_SHADOW_ROOT__: ShadowRoot
}
