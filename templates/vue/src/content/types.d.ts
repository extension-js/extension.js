declare global {
  interface ImportMeta {
    webpackHot?: {
      accept: (module?: string, callback?: () => void) => void
      dispose: (callback: () => void) => void
    }
  }
}

export {}
