import webpack from 'webpack'
import handleInsecureCSPValueError from './handleInsecureCSPValueError'
import handleWrongWebResourceFormatError from './handleWrongWebResourceFormatError'
import {ManifestBase} from '../manifest-types'

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

  if (insecureCSPValueError) {
    compilation.errors.push(insecureCSPValueError)
  }

  if (wrongWebResourceFormatError) {
    compilation.errors.push(wrongWebResourceFormatError)
  }
}
