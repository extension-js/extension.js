import type webpack from 'webpack'
import {
  type FilepathList,
  type PluginInterface,
  type Manifest
} from '../../../webpack-types'
import * as messages from '../../../lib/messages'
import {DevOptions} from '../../../../module'

export class AddPublicPathForMainWorld {
  public readonly manifestPath: string
  public readonly browser: DevOptions['browser']
  public readonly includeList: FilepathList
  public readonly excludeList: FilepathList

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
    this.includeList = options.includeList || {}
    this.excludeList = options.excludeList || {}
  }

  public apply(compiler: webpack.Compiler): void {
    const manifest: Manifest = require(this.manifestPath)
    if (
      manifest.content_scripts?.some(
        // @ts-expect-error - TS doesn't know about content_scripts
        (cs) => cs.world && cs.world.toLowerCase() === 'main'
      )
    ) {
      if (!manifest.id) {
        console.error(messages.noExtensionIdError(manifest.name || ''))
        process.exit(1)
      }

      if (this.browser === 'firefox') {
        compiler.options.output.publicPath = `moz-extension://${manifest.id}/`
        return
      }

      compiler.options.output.publicPath = `${this.browser}-extension://${manifest.id}/`
    }
  }
}
