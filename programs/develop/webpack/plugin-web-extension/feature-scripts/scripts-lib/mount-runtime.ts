// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

// These globals exist at runtime in the browser contexts where this file runs.
// Declare them here to satisfy TypeScript in non-DOM build environments.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const document: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const window: any
export type MountFn = () => void | (() => void)

export type RunAt = 'document_start' | 'document_end' | 'document_idle'

function whenReady(runAt: RunAt, cb: () => void): () => void {
  try {
    if (typeof document === 'undefined') {
      cb()
      return () => {}
    }

    if (runAt === 'document_start') {
      cb()
      return () => {}
    }

    const isReady = () => {
      if (runAt === 'document_end') {
        return (
          document.readyState === 'interactive' ||
          document.readyState === 'complete'
        )
      }
      if (runAt === 'document_idle') {
        // Chrome may inject between document_end and after window.onload; don't force waiting for 'complete'.
        return document.readyState !== 'loading'
      }
      return document.readyState === 'complete'
    }

    if (isReady()) {
      cb()
      return () => {}
    }

    let isDone = false
    const onReady = () => {
      try {
        if (isDone) return
        if (isReady()) {
          isDone = true
          document.removeEventListener('readystatechange', onReady)
          cb()
        }
      } catch {
        // ignore
      }
    }
    document.addEventListener('readystatechange', onReady)

    return () => {
      try {
        if (!isDone) document.removeEventListener('readystatechange', onReady)
      } catch {
        // ignore
      }
    }
  } catch {
    try {
      cb()
    } catch {
      // ignore
    }
    return () => {}
  }
}

export function mountWithHMR(mount: MountFn, runAt: RunAt = 'document_idle') {
  let cleanup: void | (() => void)
  let cancelReady: (() => void) | undefined

  const apply = () => {
    try {
      cleanup = mount()
    } catch (error) {
      console.error('[extension.js] Error applying mount', error)
    }
  }

  const unmount = () => {
    try {
      cancelReady?.()
      typeof cleanup === 'function' && cleanup()
    } catch (error) {
      console.error('[extension.js] Error unmounting', error)
    }
  }

  const remount = () => {
    unmount()
    apply()
  }

  cancelReady = whenReady(runAt, apply)

  // JS HMR lifecycle
  // @ts-ignore - webpackHot is not typed
  if (import.meta.webpackHot) {
    try {
      // @ts-ignore - webpackHot is not typed
      import.meta.webpackHot.accept()
      // @ts-ignore - webpackHot is not typed
      import.meta.webpackHot.dispose(unmount)
    } catch (error) {
      console.error('[extension.js] Error accepting HMR', error)
    }
  }

  // CSS HMR signal (injected by loader when CSS imports exist)
  const cssEvt = '__EXTENSIONJS_CSS_UPDATE__'
  const onCss = () => remount()
  window.addEventListener(cssEvt, onCss)

  return () => {
    window.removeEventListener(cssEvt, onCss)
    unmount()
  }
}
