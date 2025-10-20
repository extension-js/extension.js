declare global {
  interface ImportMeta {
    webpackHot?: {
      accept: (module?: string, callback?: () => void) => void
      dispose: (callback: () => void) => void
    }
  }
}

declare module '*.svg' {
  const content: string
  export default content
}

export {}
