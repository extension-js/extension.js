// Required Extension.js types for TypeScript projects.
// This file is published by the extension package.
/// <reference types="node" />
/// <reference types="chrome" />

declare global {
  // Align types with Extension.js runtime: we provide the browser global via
  // webextension-polyfill in Chromium, and it's natively available in Firefox.
  const browser: typeof import('webextension-polyfill')

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
    EXTENSION_PUBLIC_LLM_API_KEY: string
    EXTENSION_AUTHOR_MODE: string
    EXTENSION_PUBLIC_AUTHOR_MODE: string
  }

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

// Asset imports (CSS modules + static images)
type CSSContentData = Readonly<Record<string, string>>
type CSSModuleData = Readonly<Record<string, string>>

declare module '*.css' {
  const content: CSSContentData
  export default content
}

declare module '*.module.css' {
  const content: CSSModuleData
  export default content
}
declare module '*.module.scss' {
  const content: CSSModuleData
  export default content
}
declare module '*.module.sass' {
  const content: CSSModuleData
  export default content
}

declare module '*.png' {
  const content: string
  export default content
}
declare module '*.jpg' {
  const content: string
  export default content
}
declare module '*.jpeg' {
  const content: string
  export default content
}
declare module '*.gif' {
  const content: string
  export default content
}
declare module '*.webp' {
  const content: string
  export default content
}
declare module '*.avif' {
  const content: string
  export default content
}
declare module '*.ico' {
  const content: string
  export default content
}
declare module '*.bmp' {
  const content: string
  export default content
}
declare module '*.svg' {
  // Use any to avoid conflicts with SVGR or other SVG loaders.
  const content: any
  export default content
}

export {}
