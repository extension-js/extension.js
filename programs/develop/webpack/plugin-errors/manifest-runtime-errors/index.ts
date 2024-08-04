import webpack, {type Compiler} from 'webpack'
import fs from 'fs'
import {type PluginInterface, type Manifest} from '../../webpack-types'
import {insecureCSPValueError} from './insecure-csp-value-errors'
import {wrongWebResourceFormatError} from './wrong-web-resource-format-error'
import {firefoxRunningServiceWorkerError} from './firefox-service-worker-error'
import {noDefaultLocaleError} from './no-default-locale-error'

export class ManifestRuntimeErrorsPlugin {
  private readonly options: PluginInterface

  constructor(options: PluginInterface) {
    this.options = options
  }

  handleRuntimeErrors(
    compilation: webpack.Compilation,
    manifest: Manifest,
    browser: string
  ) {
    const insecureCSPValue = insecureCSPValueError(manifest)
    const wrongWebResourceFormat = wrongWebResourceFormatError(
      manifest,
      browser
    )
    const firefoxRunningServiceWorker = firefoxRunningServiceWorkerError(
      manifest,
      browser
    )
    const noDefaultLocale = noDefaultLocaleError(manifest, compilation)

    if (insecureCSPValue) {
      compilation.errors.push(insecureCSPValue)
    }

    if (wrongWebResourceFormat) {
      compilation.errors.push(wrongWebResourceFormat)
    }

    if (firefoxRunningServiceWorker) {
      if (compilation.options.mode === 'production') {
        compilation.errors.push(firefoxRunningServiceWorker)
      }
    }

    if (noDefaultLocale) {
      compilation.errors.push(noDefaultLocale)
    }
  }

  apply(compiler: Compiler) {
    // When a manifest.json has valid fields but during extension execution,
    // the browser does not support the field.
    // - A manifest field that is not supported by the browser.
    // - A security policy that is not supported by the browser.
    compiler.hooks.afterCompile.tapAsync(
      'CompatPlugin (module)',
      (compilation, done) => {
        const manifestPath = this.options.manifestPath
        const manifest: Manifest = JSON.parse(
          fs.readFileSync(manifestPath, 'utf-8')
        )
        const browser = this.options.browser || 'chrome'

        this.handleRuntimeErrors(compilation, manifest, browser)

        done()
      }
    )
  }
}
