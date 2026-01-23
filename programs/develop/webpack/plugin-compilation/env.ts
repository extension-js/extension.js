//  ██████╗ ██████╗ ███╗   ███╗██████╗ ██╗██╗      █████╗ ████████╗██╗ ██████╗ ███╗   ██╗
// ██╔════╝██╔═══██╗████╗ ████║██╔══██╗██║██║     ██╔══██╗╚══██╔══╝██║██╔═══██╗████╗  ██║
// ██║     ██║   ██║██╔████╔██║██████╔╝██║██║     ███████║   ██║   ██║██║   ██║██╔██╗ ██║
// ██║     ██║   ██║██║╚██╔╝██║██╔═══╝ ██║██║     ██╔══██║   ██║   ██║██║   ██║██║╚██╗██║
// ╚██████╗╚██████╔╝██║ ╚═╝ ██║██║     ██║███████╗██║  ██║   ██║   ██║╚██████╔╝██║ ╚████║
//  ╚═════╝ ╚═════╝ ╚═╝     ╚═╝╚═╝     ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚═╝ ╚═════╝ ╚═╝  ╚═══╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as fs from 'fs'
import * as path from 'path'
import {Compiler, Compilation, DefinePlugin, sources} from '@rspack/core'
import * as dotenv from 'dotenv'
import type {PluginInterface, DevOptions} from '../webpack-types'
import * as messages from './compilation-lib/messages'

export class EnvPlugin {
  public readonly browser: DevOptions['browser']
  public readonly manifestPath?: string

  constructor(options: Partial<PluginInterface>) {
    this.browser = options.browser || 'chrome'
    this.manifestPath = options.manifestPath
  }

  apply(compiler: Compiler) {
    const projectPath =
      (compiler.options.context as string) ||
      (this.manifestPath ? path.dirname(this.manifestPath) : '')
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

    if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
      console.log(messages.envSelectedFile(envPath))
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

    // Ensure `process` exists in browser contexts.
    //
    // Some ecosystems (notably Bun) do not provide a global `process` in the browser,
    // and users often read `process.env.*` from React/Vue/etc. While DefinePlugin
    // replaces known `process.env.X` occurrences, any direct `process` / `process.env`
    // access would otherwise throw at runtime.
    //
    // We keep this intentionally minimal: a stub `process` with an `env` object.
    filteredEnvVars['process.env'] = JSON.stringify({})
    // Wrap in parentheses so property access stays valid after replacement.
    filteredEnvVars['process'] = '({env: {}})'

    // Ensure default environment variables are always available:
    // - EXTENSION_PUBLIC_BROWSER (legacy)
    // - EXTENSION_PUBLIC_MODE (legacy)
    // - EXTENSION_BROWSER
    // - BROWSER
    // (after v3)
    // - EXTENSION_MODE
    // - MODE
    filteredEnvVars['process.env.EXTENSION_PUBLIC_BROWSER'] = JSON.stringify(
      this.browser
    )
    filteredEnvVars['import.meta.env.EXTENSION_PUBLIC_BROWSER'] =
      JSON.stringify(this.browser)
    filteredEnvVars['process.env.EXTENSION_PUBLIC_MODE'] = JSON.stringify(mode)
    filteredEnvVars['import.meta.env.EXTENSION_PUBLIC_MODE'] =
      JSON.stringify(mode)
    filteredEnvVars['process.env.EXTENSION_BROWSER'] = JSON.stringify(
      this.browser
    )
    filteredEnvVars['import.meta.env.EXTENSION_BROWSER'] = JSON.stringify(
      this.browser
    )
    filteredEnvVars['process.env.EXTENSION_MODE'] = JSON.stringify(mode)
    filteredEnvVars['import.meta.env.EXTENSION_MODE'] = JSON.stringify(mode)

    // New after v3
    filteredEnvVars['process.env.BROWSER'] = JSON.stringify(this.browser)
    filteredEnvVars['import.meta.env.BROWSER'] = JSON.stringify(this.browser)
    filteredEnvVars['process.env.MODE'] = JSON.stringify(mode)
    filteredEnvVars['import.meta.env.MODE'] = JSON.stringify(mode)

    const injectedCount = Object.keys(filteredEnvVars).filter((k) =>
      k.startsWith('process.env.EXTENSION_PUBLIC_')
    ).length

    if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
      console.log(messages.envInjectedPublicVars(injectedCount))
    }

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
            // Prefer compilation assets to be robust against different bundler versions
            const files = Object.keys((compilation as any).assets || assets)

            files.forEach((filename) => {
              if (filename.endsWith('.json') || filename.endsWith('.html')) {
                let fileContent = (compilation as any).assets[filename]
                  .source()
                  .toString()

                const resolveVar = (name: string): string => {
                  // Prefer system > explicit env file > defaults; preserve when missing
                  if (Object.prototype.hasOwnProperty.call(process.env, name)) {
                    const systemValue = process.env[name]
                    if (typeof systemValue === 'string') return systemValue
                  }

                  if (Object.prototype.hasOwnProperty.call(envVars, name)) {
                    const explicitEnvValue = (
                      envVars as Record<string, string | undefined>
                    )[name]
                    if (typeof explicitEnvValue === 'string')
                      return explicitEnvValue
                  }

                  if (
                    Object.prototype.hasOwnProperty.call(defaultsVars, name)
                  ) {
                    const defaultsValue = (
                      defaultsVars as Record<string, string | undefined>
                    )[name]
                    if (typeof defaultsValue === 'string') return defaultsValue
                  }
                  const combinedValue = (combinedVars as Record<string, any>)[
                    name
                  ]

                  return typeof combinedValue === 'string'
                    ? combinedValue
                    : `$${name}`
                }

                // Replace environment variables in the format $EXTENSION_PUBLIC_VAR (legacy)
                fileContent = fileContent.replace(
                  /\$EXTENSION_PUBLIC_[A-Z_]+/g,
                  (match: string) => {
                    const envVarName = match.slice(1) // Remove the '$'
                    return resolveVar(envVarName)
                  }
                )

                // Replace environment variables in the format $EXTENSION_VAR
                fileContent = fileContent.replace(
                  /\$EXTENSION_[A-Z_]+/g,
                  (match: string) => {
                    const envVarName = match.slice(1) // Remove the '$'
                    return resolveVar(envVarName)
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
