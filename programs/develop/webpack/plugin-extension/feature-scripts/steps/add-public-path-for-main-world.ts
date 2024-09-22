import {Compiler} from 'webpack'
import {
  type FilepathList,
  type PluginInterface,
  type Manifest
} from '../../../webpack-types'
import * as messages from '../../../lib/messages'
import * as utils from '../../../lib/utils'
import {DevOptions} from '../../../../commands/dev'
import {CHROMIUM_BASED_BROWSERS} from '../../../lib/constants'

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

  public apply(_compiler: Compiler): void {
    const initialManifest: Manifest = require(this.manifestPath)
    const manifest = utils.filterKeysForThisBrowser(
      initialManifest,
      this.browser
    )

    if (
      manifest.content_scripts?.some(
        // @ts-expect-error - TS doesn't know about content_scripts
        (cs) => cs.world && cs.world.toLowerCase() === 'main'
      )
    ) {
      if (CHROMIUM_BASED_BROWSERS.includes(this.browser) && !manifest.key) {
        console.error(messages.noExtensionIdError())
        process.exit(1)
      }
    }
  }
}
