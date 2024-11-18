import fs from 'fs'
import path from 'path'
import {Compiler, Compilation, DefinePlugin, sources} from 'webpack'
import dotenv from 'dotenv'
import {PluginInterface} from '../webpack-types'
import {DevOptions} from '../../commands/commands-lib/config-types'

export class EnvPlugin {
  public readonly manifestPath: string
  public readonly browser: DevOptions['browser']

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
  }

  apply(compiler: Compiler) {
    const projectPath = path.dirname(this.manifestPath)
    const mode = compiler.options.mode || 'development'

    // Collect .env files based on browser and mode
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

    // Load the .env file manually and filter variables prefixed with 'EXTENSION_PUBLIC_'
    const envVars = envPath ? dotenv.config({path: envPath}).parsed || {} : {}
    const defaultsPath = path.join(projectPath, '.env.defaults')
    const defaultsVars = fs.existsSync(defaultsPath)
      ? dotenv.config({path: defaultsPath}).parsed || {}
      : {}

    // Merge all environment variables (including system env vars)
    const combinedVars = {
      ...defaultsVars,
      ...envVars,
      ...process.env // Include system variables
    }

    // Filter out variables with EXTENSION_PUBLIC_ prefix
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

    // Ensure default environment variables are always available:
    // - EXTENSION_PUBLIC_BROWSER
    // - EXTENSION_PUBLIC_MODE
    filteredEnvVars['process.env.EXTENSION_PUBLIC_BROWSER'] = JSON.stringify(
      this.browser
    )
    filteredEnvVars['import.meta.env.EXTENSION_PUBLIC_BROWSER'] =
      JSON.stringify(this.browser)
    filteredEnvVars['process.env.EXTENSION_PUBLIC_MODE'] = JSON.stringify(mode)
    filteredEnvVars['import.meta.env.EXTENSION_PUBLIC_MODE'] =
      JSON.stringify(mode)

    // Apply DefinePlugin to expose filtered variables
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
