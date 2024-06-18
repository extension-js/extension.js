import type webpack from 'webpack'
import handleInsecureCSPValueError from './handleInsecureCSPValueError'
import handleWrongWebResourceFormatError from './handleWrongWebResourceFormatError'
import handleFirefoxRunningServiceWorkerError from './handleFirefoxRunningServiceWorkerError'
import {type ManifestBase} from '../manifest-types'

export default function handleRuntimeErrors(
  compilation: webpack.Compilation,
  manifest: ManifestBase,
  browser: string
) {
  const insecureCSPValueError = handleInsecureCSPValueError(manifest)
  const wrongWebResourceFormatError = handleWrongWebResourceFormatError(
    manifest,
    browser
  )
  const firefoxRunningServiceWorkerError =
    handleFirefoxRunningServiceWorkerError(manifest, browser)

  if (insecureCSPValueError) {
    compilation.errors.push(insecureCSPValueError)
  }

  if (wrongWebResourceFormatError) {
    compilation.errors.push(wrongWebResourceFormatError)
  }

  if (firefoxRunningServiceWorkerError) {
    if (compilation.options.mode === 'production') {
      compilation.errors.push(firefoxRunningServiceWorkerError)
    }
  }
}
