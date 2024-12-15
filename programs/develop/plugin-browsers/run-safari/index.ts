import fs from 'fs'
import os from 'os'
import path from 'path'
import {type Compiler} from 'webpack'
import * as messages from '../browsers-lib/messages'
import {PluginInterface} from '../browsers-types'
import {DevOptions} from '../../module'
import {launchSafari} from './safari/launch-safari'
import {
  checkXcodeCommandLineTools,
  ensureXcodeDirectory,
  checkSafariWebExtensionConverter
} from './xcode/setup-xcode'
import {generateSafariProject} from './xcode/generate-project'

export class RunSafariPlugin {
  public readonly extension: string | string[]
  public readonly browser: DevOptions['browser']
  public readonly browserFlags?: string[]
  public readonly profile?: string
  public readonly preferences?: Record<string, any>
  public readonly startingUrl?: string

  constructor(options: PluginInterface) {
    this.extension = options.extension
    this.browser = options.browser
    this.browserFlags = options.browserFlags || []
    this.profile = options.profile
    this.preferences = options.preferences
    this.startingUrl = options.startingUrl
  }

  private isMacOS(): boolean {
    return os.platform() === 'darwin'
  }

  apply(compiler: Compiler): void {
    compiler.hooks.done.tapAsync('RunSafariPlugin', (stats, done) => {
      if (stats.hasErrors()) {
        console.error('Build failed. Aborting Safari launch.')
        done()
        return
      }

      try {
        // Ensure the environment is properly configured for Safari extension development
        checkXcodeCommandLineTools()
        // const xcodePath = ensureXcodeDirectory(process.cwd())
        const xcodePath = compiler.options.output.path || ''
        checkSafariWebExtensionConverter()

        console.log(
          `Xcode configuration verified. Using directory: ${xcodePath}`
        )

        // Check if the xcode folder is populated with the expected project
        const outputPath = path.join(
          xcodePath,
          'printfriendly-safari.xcodeproj'
        )
        if (!fs.existsSync(outputPath)) {
          console.log(
            `'xcode' folder is empty. Generating Xcode project for Safari Web Extension...`
          )
          const userExtension = Array.isArray(this.extension)
            ? this.extension[0]
            : this.extension
          // AppName is the parsed Manifest.json name
          const manifestJson = JSON.parse(
            fs.readFileSync(path.join(userExtension, 'manifest.json'), 'utf8')
          )
          // Ensure appname is valid
          const appName = manifestJson.name
          // .replace(/[^a-zA-Z0-9]/g, '')

          // i.e com.example.myextension
          const identifier = manifestJson.homepage_url
            ? manifestJson.homepage_url.replace(/[^a-zA-Z0-9]/g, '')
            : 'org.extensionjs.extension'

          generateSafariProject(userExtension, xcodePath, appName, identifier)
          console.log(`Xcode project successfully created at: ${outputPath}`)
        } else {
          console.log(`Existing Xcode project found at: ${outputPath}`)
        }

        // Launch Safari using the extracted logic
        launchSafari({
          startingUrl: this.startingUrl,
          isMacOS: this.isMacOS(),
          browser: this.browser
        })
      } catch (error: any) {
        console.error(error.message)
        process.exit(1)
      }

      done()
    })
  }
}
