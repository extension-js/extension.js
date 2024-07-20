import path from 'path'
import {type Compiler} from 'webpack'
import {bgWhite, red, bold} from '@colors/colors/safe'
import MessagingClient from './MessagingClient'
import {type RunFirefoxExtensionInterface} from '../../../types'
import {isErrorWithCode, requestErrorToMessage} from './messageUtils'

const MAX_RETRIES = 150
const RETRY_INTERVAL = 1000

const managerExtension = path.resolve(
  __dirname,
  'extensions',
  'manager-extension'
)
const reloadExtension = path.resolve(
  __dirname,
  'extensions',
  'reload-extension'
)

export default class RemoteFirefox {
  private readonly options: RunFirefoxExtensionInterface

  constructor(configOptions: RunFirefoxExtensionInterface) {
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
            `${bgWhite(red(bold(` firefox-browser `)))} ${red('✖︎✖︎✖︎')} ${
              error.stack
            }`
          )
          throw error
        }
      }
    }

    console.error(
      `${bgWhite(red(bold(` firefox-browser `)))} ${red(
        '✖︎✖︎✖︎'
      )} Unable to connect to Firefox. Too many retries.`
    )
    throw lastError
  }

  public async installAddons(compiler: Compiler) {
    const {extensionPath, autoReload, port, devtools} = this.options
    const userBrowserExtension = extensionPath?.replace('manifest.json', '')
    const extensionsToLoad = [userBrowserExtension!]

    if (compiler.options.mode === 'development') {
      if (autoReload) {
        extensionsToLoad.push(reloadExtension)
      }
    }

    if (compiler.options.mode === 'development') {
      extensionsToLoad.push(managerExtension)
    }
    const client = await this.connectClient(port! + 100)

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
          `${bgWhite(
            red(bold(` firefox-browser `))
          )} Error while installing temporary addon: ${message}`
        )
      }
    }
  }
}
