import Ajv from 'ajv'
import fs from 'fs'
import path from 'path'
import {Compiler, WebpackError} from 'webpack'
// import v2Schema from './lib/manifest.schema.v2.json'
import v3Schema from './lib/manifest.schema.v3.json'
import addCustomFormats from './src/helpers/customValidators'
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

  apply(compiler: Compiler) {
    compiler.hooks.emit.tapAsync(
      'CompatPlugin (module)',
      (compilation, done) => {
        const manifestPath = path.resolve(
          compiler.options.context!,
          this.options.manifestPath
        )
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))

        const ajv = new Ajv()
        addCustomFormats(ajv)

        const combinedSchema = {
          allOf: [v3Schema]
        }

        const validate = ajv.compile(combinedSchema)
        const valid = validate(manifest)

        if (!valid) {
          const field = validate.errors?.[0].instancePath.replaceAll('/', '.').slice(1) || ''
          const extensionKnowledge = bcd.webextensions.manifest
          const message = validate.errors?.[0].message
          const namespace = field?.split('.')[0]
          const chromeUrl = `https://developer.chrome.com/docs/extensions/reference/api/${namespace}`
          const mdnUrl = extensionKnowledge?.[namespace].__compat?.mdn_url
          const isChrome = this.options.browser === 'chrome'
          const browserName = this.options.browser
            ? this.options.browser.substring(0, 1).toUpperCase() + this.options.browser.substring(1)
            : 'Chrome'

          compilation.warnings.push(
            new WebpackError(
`[manifest.json]: Manifest field ${field} ${message?.replace('be', 'be of type')}.

Read more about the \`${namespace}\` namespace on ${browserName}'s documentation:
${isChrome ? chromeUrl : mdnUrl}.`
            )
          )
        }

        done()
      }
    )
  }
}
