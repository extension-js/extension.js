import {type LoaderContext} from '../../../webpack-types'

export default function (this: LoaderContext, source: string) {
  try {
    const foundWebpackHot = source.includes('import.meta.webpackHot')
    const foundViteHot = source.includes('import.meta.hot')
    if (foundWebpackHot || foundViteHot) {
      const which = foundWebpackHot
        ? 'import.meta.webpackHot'
        : 'import.meta.hot'
      const msg = `Detected ${which} in ${this.resourcePath}. Extension.js now manages HMR automatically. Please remove framework-specific HMR calls from your source.`
      // Prefer emitWarning if available (webpack/rspack)
      if (typeof (this as any).emitWarning === 'function') {
        ;(this as any).emitWarning(new Error(msg))
      } else {
        console.warn('[Extension.js]', msg)
      }
    }
  } catch (_) {}

  return source
}
