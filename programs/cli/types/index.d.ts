/// <reference types="node" />
/// <reference types="chrome" />
/// <reference types="./js-frameworks.d.ts" />
/// <reference path="./css-content.d.ts" />
/// <reference path="./css-modules.d.ts" />
/// <reference path="./images.d.ts" />

declare namespace NodeJS {
  interface ProcessEnv {
    readonly EXTENSION_BROWSER:
      | 'chrome'
      | 'edge'
      | 'firefox'
      | 'chromium-based'
      | 'gecko-based'
    readonly EXTENSION_MODE: 'development' | 'production'
  }
}

interface ImportMetaEnv {
  readonly EXTENSION_BROWSER: NodeJS.ProcessEnv['EXTENSION_BROWSER']
  readonly EXTENSION_MODE: NodeJS.ProcessEnv['EXTENSION_MODE']
}

interface WebpackHot {
  accept: (...args: string[]) => void
  dispose: (...args: string[]) => void
}

interface ImportMeta {
  readonly env: ImportMetaEnv
  readonly webpackHot: WebpackHot
}

interface Window {
  __EXTENSION_SHADOW_ROOT__: ShadowRoot
}
