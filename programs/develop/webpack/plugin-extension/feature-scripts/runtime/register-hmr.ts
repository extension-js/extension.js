// Minimal runtime to make HMR safe for self-bootstrapping content scripts
// Removes a common root element on dispose so top-level side effects can re-run cleanly

declare global {
  interface ImportMeta {
    readonly webpackHot?: {
      accept: (module?: string | string[], callback?: () => void) => void
      dispose: (callback: () => void) => void
    }
  }
}

if (import.meta.webpackHot) {
  try {
    import.meta.webpackHot.accept()
    import.meta.webpackHot.dispose(() => {
      try {
        // Best-effort cleanup: remove a known extension root if present
        const knownRoots = ['#extension-root', '[data-extension-root="true"]']
        const d: any =
          typeof globalThis !== 'undefined'
            ? (globalThis as any).document
            : undefined
        for (const selector of knownRoots) {
          const el =
            d && d.querySelector
              ? (d.querySelector(selector) as any | null)
              : null
          const parent = (el && (el as any).parentElement) || null
          if (el && parent && parent.removeChild) parent.removeChild(el)
        }
      } catch (e) {
        // noop
      }
    })
  } catch (e) {
    // noop
  }
}
