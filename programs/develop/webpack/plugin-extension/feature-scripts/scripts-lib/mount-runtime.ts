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

export function mountWithHMR(mount: MountFn) {
  let cleanup: void | (() => void)

  const apply = () => {
    try {
      cleanup = mount()
    } catch (error) {
      console.error('[extension.js] Error applying mount', error)
    }
  }

  const unmount = () => {
    try {
      typeof cleanup === 'function' && cleanup()
    } catch (error) {
      console.error('[extension.js] Error unmounting', error)
    }
  }

  const remount = () => {
    unmount()
    apply()
  }

  if (document.readyState === 'complete') {
    apply()
  } else {
    const onReady = () => {
      if (document.readyState === 'complete') {
        document.removeEventListener('readystatechange', onReady)
        apply()
      }
    }
    document.addEventListener('readystatechange', onReady)
  }

  // JS HMR lifecycle
  // @ts-expect-error - webpackHot is not typed
  if (import.meta.webpackHot) {
    try {
      // @ts-expect-error - webpackHot is not typed
      import.meta.webpackHot.accept()
      // @ts-expect-error - webpackHot is not typed
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
