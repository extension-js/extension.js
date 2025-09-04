// Minimal runtime to make HMR safe for self-bootstrapping content scripts
// Removes a common root element on dispose so top-level side effects can re-run cleanly

declare global {
  interface ImportMeta {
    webpackHot?: {
      accept: (dep?: any, cb?: () => void) => void
      dispose: (cb: () => void) => void
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
        for (const selector of knownRoots) {
          const el = document.querySelector(selector) as HTMLElement | null
          if (el && el.parentElement) {
            el.parentElement.removeChild(el)
          }
        }
      } catch (e) {
        // noop
      }
    })
  } catch (e) {
    // noop
  }
}
