import fs from 'fs'
import path from 'path'
import {Compiler, Compilation, DefinePlugin, sources} from 'webpack'
import dotenv from 'dotenv'
import * as messages from '../lib/messages'
import {PluginInterface, Manifest} from '../webpack-types'
import {DevOptions} from '../../commands/dev'

export class EnvPlugin {
  public readonly manifestPath: string
  public readonly browser: DevOptions['browser']

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
  }

  apply(compiler: Compiler) {
    const projectPath = path.dirname(this.manifestPath)
    const manifest: Manifest = require(this.manifestPath)
    const manifestName = manifest.name || 'Extension.js'
    const mode = compiler.options.mode || 'development'

    const envFiles = [
      `.env.${this.browser}.${mode}`, // .env.chrome.development
      `.env.${this.browser}`, // .env.chrome
      `.env.${mode}`, // .env.development
      '.env.local', // .env.local
      '.env', // .env
      '.env.example' // .env.example as fallback
    ]

    // Find the first valid .env file that exists
    let envPath = ''
    for (const file of envFiles) {
      const filePath = path.join(projectPath, file)
      if (fs.existsSync(filePath)) {
        envPath = filePath
        break
      }
    }

    if (!envPath) return

    console.log(messages.envFileLoaded(manifestName))

    // Load the .env file manually and filter variables prefixed with 'EXTENSION_PUBLIC_'
    const envVars = dotenv.config({path: envPath}).parsed || {}
    const defaultsPath = path.join(projectPath, '.env.defaults')
    const defaultsVars = fs.existsSync(defaultsPath)
      ? dotenv.config({path: defaultsPath}).parsed || {}
      : {}

    const combinedVars = {
      ...defaultsVars,
      ...envVars,
      ...process.env // Include system variables
    }

    const filteredEnvVars = Object.keys(combinedVars)
      .filter((key) => key.startsWith('EXTENSION_PUBLIC_'))
      .reduce(
        (obj, key) => {
          obj[`process.env.${key}`] = JSON.stringify(combinedVars[key])
          // Support for import.meta.env
          obj[`import.meta.env.${key}`] = JSON.stringify(combinedVars[key])
          return obj
        },
        {} as Record<string, string>
      )

    // Apply DefinePlugin to expose filtered variables to the final bundle
    new DefinePlugin(filteredEnvVars).apply(compiler)

    // Process all .json and .html files in the output directory
    compiler.hooks.thisCompilation.tap(
      'manifest:update-manifest',
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'env:module',
            stage: Compilation.PROCESS_ASSETS_STAGE_SUMMARIZE
          },
          (assets) => {
            const files = Object.keys(assets)

            files.forEach((filename) => {
              if (filename.endsWith('.json') || filename.endsWith('.html')) {
                let fileContent = compilation.assets[filename]
                  .source()
                  .toString()

                // Replace environment variables in the format $EXTENSION_PUBLIC_VAR
                fileContent = fileContent.replace(
                  /\$EXTENSION_PUBLIC_[A-Z_]+/g,
                  (match) => {
                    const envVarName = match.slice(1) // Remove the '$'
                    const value = combinedVars[envVarName] || match
                    console.log(`Replacing ${match} with ${value}`)
                    return value
                  }
                )

                compilation.updateAsset(
                  filename,
                  new sources.RawSource(fileContent)
                )
              }
            })
          }
        )
      }
    )
  }
}
