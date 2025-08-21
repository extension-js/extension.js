/// <reference types="node" />
/// <reference types="chrome" />
/// <reference types="./js-frameworks.d.ts" />
/// <reference path="./css-content.d.ts" />
/// <reference path="./css-modules.d.ts" />
/// <reference path="./images.d.ts" />

type ExtensionBrowser =
  | 'chrome'
  | 'edge'
  | 'firefox'
  | 'chromium-based'
  | 'gecko-based'

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

// Global augmentations
declare global {
  namespace NodeJS {
    interface ProcessEnv extends ExtensionEnv {
      [key: string]: string | undefined
    }
  }

  interface ImportMetaEnv extends ExtensionEnv {
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

  interface Window {
    /**
     * @deprecated
     * @description
     * This is how Extension.js used to inject the shadow root into the window object.
     * Use the shadowRoot reference from the content script instead.
     */
    __EXTENSION_SHADOW_ROOT__: ShadowRoot
  }
}

// This export is needed for TypeScript to treat this file as a module
export {}
