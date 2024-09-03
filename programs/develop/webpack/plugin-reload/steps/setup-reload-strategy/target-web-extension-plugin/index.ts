import fs from 'fs'
import path from 'path'
import {type Compiler} from '@rspack/core'
// import {WebExtensionPlugin} from './rspack-target-webextension'
import {type PluginInterface} from '../../../reload-types'
import {type Manifest} from '../../../../webpack-types'
import {type DevOptions} from '../../../../../commands/dev'
import * as messages from '../../../../lib/messages'

export class TargetWebExtensionPlugin {
  private readonly manifestPath: string
  private readonly browser: DevOptions['browser']

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
  }

  private handleBackground(
    compiler: Compiler,
    browser: DevOptions['browser'],
    manifest: Manifest
  ) {
    const minimumBgScript = path.resolve(
      __dirname,
      browser === 'firefox'
        ? 'minimum-firefox-file.mjs'
        : 'minimum-chromium-file.mjs'
    )
    const dirname = path.dirname(this.manifestPath!)

    let manifestBg: Record<string, any> | undefined = manifest.background

    if (browser === 'firefox') {
      manifestBg =
        manifest['gecko:background'] ||
        manifest['firefox:background'] ||
        manifestBg

      const backgroundScripts =
        manifestBg?.scripts ||
        manifestBg?.['gecko:scripts'] ||
        manifestBg?.['firefox:scripts']

      if (backgroundScripts && backgroundScripts.length > 0) {
        const backgroundScriptPath = path.join(dirname, backgroundScripts[0])
        this.ensureFileExists(backgroundScriptPath, 'background.scripts')
      } else {
        this.addDefaultEntry(compiler, 'background/script', minimumBgScript)
      }
    } else {
      manifestBg =
        manifest[`chromium:background`] ||
        manifest[`chrome:background`] ||
        manifest[`edge:background`] ||
        manifestBg

      if (manifest.manifest_version === 3) {
        const serviceWorker =
          manifestBg?.service_worker ||
          manifestBg?.['chromium:service_worker'] ||
          manifestBg?.['chrome:service_worker'] ||
          manifestBg?.['edge:service_worker']

        if (serviceWorker) {
          const serviceWorkerPath = path.join(dirname, serviceWorker)
          this.ensureFileExists(serviceWorkerPath, 'background.service_worker')
        } else {
          this.addDefaultEntry(
            compiler,
            'background/service_worker',
            minimumBgScript
          )
        }
      } else if (manifest.manifest_version === 2) {
        const backgroundScripts =
          manifestBg?.scripts ||
          manifestBg?.['chromium:scripts'] ||
          manifestBg?.['chrome:scripts'] ||
          manifestBg?.['edge:scripts']

        if (backgroundScripts && backgroundScripts.length > 0) {
          const backgroundScriptPath = path.join(dirname, backgroundScripts[0])
          this.ensureFileExists(backgroundScriptPath, 'background.scripts')
        } else {
          this.addDefaultEntry(compiler, 'background/script', minimumBgScript)
        }
      }
    }
  }

  private ensureFileExists(filePath: string, fieldName: string) {
    if (!fs.existsSync(filePath)) {
      if (this.manifestPath) {
        const manifest: Manifest = require(this.manifestPath)
        const manifestName = manifest.name || 'Extension.js'
        const fieldError = messages.backgroundIsRequired(
          manifestName,
          fieldName,
          filePath
        )
        console.error(fieldError)
        throw new Error(fieldError)
      }
    }
  }

  private addDefaultEntry(
    compiler: Compiler,
    name: string,
    defaultScript: string
  ) {
    compiler.options.entry = {
      ...compiler.options.entry,
      [name]: {import: [defaultScript]}
    }
  }

  // private getEntryName(manifest: Manifest) {
  //   if (manifest.background) {
  //     if (manifest.manifest_version === 3) {
  //       return {serviceWorkerEntry: 'background/service_worker'}
  //     }

  //     if (manifest.manifest_version === 2) {
  //       return {pageEntry: 'background/script'}
  //     }
  //   }

  //   return {pageEntry: 'background'}
  // }

  public apply(compiler: Compiler) {
    if (!this.manifestPath || !fs.lstatSync(this.manifestPath).isFile()) {
      return
    }

    const manifest: Manifest = require(this.manifestPath)

    this.handleBackground(compiler, this.browser, manifest)

    // new WebExtensionPlugin({
    //   background: this.getEntryName(manifest),
    //   weakRuntimeCheck: true
    // }).apply(compiler)
  }
}
