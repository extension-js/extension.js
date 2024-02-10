import Ajv, {ErrorObject} from 'ajv'
import fs from 'fs'
import path from 'path'
import {Compiler, WebpackError} from 'webpack'
import v3Schema from './lib/manifest.schema.v3.json'
import bcd from '@mdn/browser-compat-data'

interface ManifestCompatPluginOptions {
  manifestPath: string
  browser?: string
}

export default class ManifestCompatPlugin {
  private options: ManifestCompatPluginOptions

  constructor(options: ManifestCompatPluginOptions) {
    this.options = options
  }

  private getApiDocumentationURL(browser: string, namespace: string) {
    const extensionKnowledge = bcd.webextensions.manifest
    const isChrome = browser === 'chrome'
    const chromeUrl = `https://developer.chrome.com/docs/extensions/reference/api/${namespace}`
    const mdnUrl = extensionKnowledge?.[namespace].__compat?.mdn_url

    return isChrome ? chromeUrl : mdnUrl
  }

  private getManifestDocumentationURL(browser?: string) {
    const isChrome = browser === 'chrome'
    const chromeUrl =
      'https://developer.chrome.com/docs/extensions/reference/manifest'
    const mdnUrl = `https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json`

    return isChrome ? chromeUrl : mdnUrl
  }

  private missingRequiredFieldError(message: string | undefined) {
    const hintMessage = `Update your manifest.json file to run your extension.`
    const errorMessage = `Field \`${message}\` is required. ${hintMessage}

Read more about the \`${message}\` field:
${this.getManifestDocumentationURL(this.options.browser)}`
    return errorMessage
  }

  private invalidTypeFieldError(errorData: ErrorObject | undefined) {
    const field = errorData?.instancePath.replaceAll('/', '.').slice(1) || ''
    const message = errorData?.message
    const namespace = field?.split('.')[0]

    return `Field ${field} ${message?.replace('be', 'be of type')}.

Read more about the \`${namespace}\` namespace:
${this.getApiDocumentationURL('chrome', namespace)}`
  }

  apply(compiler: Compiler) {
    compiler.hooks.afterCompile.tapAsync(
      'CompatPlugin (module)',
      (compilation, done) => {
        const manifestPath = path.resolve(
          compiler.options.context!,
          this.options.manifestPath
        )
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))

        const ajv = new Ajv()

        const combinedSchema = {
          allOf: [v3Schema]
        }

        const validate = ajv.compile(combinedSchema)
        const valid = validate(manifest)

        if (!valid) {
          const errorData = validate.errors?.[0]

          if (errorData?.keyword === 'required') {
            const missingProperty = errorData?.params.missingProperty
            compilation.errors.push(
              new WebpackError(
                `[manifest.json]: ${this.missingRequiredFieldError(missingProperty)}`
              )
            )

            done()
            return
          }

          compilation.warnings.push(
            new WebpackError(
              `[manifest.json]: ${this.invalidTypeFieldError(errorData)}`
            )
          )
        }

        done()
      }
    )
  }
}
