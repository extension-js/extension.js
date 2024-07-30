import path from 'path'
import {type Compiler} from 'webpack'
import {MessagingClient} from './messaging-client'
import {isErrorWithCode, requestErrorToMessage} from './message-utils'
import {type PluginInterface} from '../../types'
import * as messages from '../../browser-lib/messages'

const MAX_RETRIES = 150
const RETRY_INTERVAL = 1000

export class RemoteFirefox {
  private readonly options: PluginInterface

  constructor(configOptions: PluginInterface) {
    this.options = configOptions
  }

  private async connectClient(port: number) {
    let lastError

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for (const _ of Array.from({length: MAX_RETRIES})) {
      try {
        const client = new MessagingClient()
        await client.connect(port)
        return client
      } catch (error: any) {
        if (isErrorWithCode('ECONNREFUSED', error)) {
          await new Promise((resolve) => setTimeout(resolve, RETRY_INTERVAL))
          lastError = error
        } else {
          console.error(
            messages.generalBrowserError(this.options.browser, error.stack)
          )
          throw error
        }
      }
    }

    console.error(messages.errorConnectingToBrowser(this.options.browser))
    throw lastError
  }

  public async installAddons(compiler: Compiler) {
    const {devtools} = this.options
    const extensionsToLoad = Array.isArray(this.options.extension)
      ? this.options.extension
      : [this.options.extension]

    const devPort = (compiler.options.devServer as any)?.port
    const port = devPort ? devPort + 100 : 9222
    const client = await this.connectClient(port)

    for (const [index, extension] of extensionsToLoad.entries()) {
      const addonPath = path.join(extension.replace(/"/g, ''))
      const isDevtoolsEnabled = index === 0 && devtools

      try {
        const addons = await client.request({to: 'root', type: 'getRoot'})

        await client.request({
          to: addons.addonsActor,
          type: 'installTemporaryAddon',
          addonPath,
          openDevTools: isDevtoolsEnabled
        })
      } catch (err) {
        const message = requestErrorToMessage(err)
        throw new Error(
          messages.errorInstallingAddOn(this.options.browser, message)
        )
      }
    }
  }
}
