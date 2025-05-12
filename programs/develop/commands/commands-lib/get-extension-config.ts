import * as fs from 'fs'
import * as path from 'path'
import {Configuration} from '@rspack/core'
import {BrowserConfig, FileConfig} from './config-types'
import {DevOptions} from '../../commands/commands-lib/config-types'
import * as messages from './messages'

async function loadConfigFile(configPath: string): Promise<FileConfig> {
  const absolutePath = path.resolve(configPath)

  try {
    // Try to load as ESM module first
    const module = await import(absolutePath)
    return module.default || module
  } catch (err: unknown) {
    const error = err as Error
    // If ESM import fails, try to parse as JSON
    try {
      const content = fs.readFileSync(absolutePath, 'utf-8')
      return JSON.parse(content)
    } catch (jsonErr: unknown) {
      throw new Error(
        `Failed to load config file: ${configPath}\nError: ${error.message || error}`
      )
    }
  }
}

export async function loadCustomWebpackConfig(projectPath: string) {
  const userConfigPath = path.join(projectPath, 'extension.config.js')
  const moduleUserConfigPath = path.join(projectPath, 'extension.config.mjs')

  if (fs.existsSync(userConfigPath) || fs.existsSync(moduleUserConfigPath)) {
    const configPath = fs.existsSync(userConfigPath)
      ? userConfigPath
      : moduleUserConfigPath

    if (await isUsingExperimentalConfig(projectPath)) {
      try {
        const userConfig = await loadConfigFile(configPath)
        if (userConfig && typeof userConfig.config === 'function') {
          return userConfig.config
        }
      } catch (err: unknown) {
        const error = err as Error
        console.error(`Error loading webpack config: ${error.message}`)
        throw err
      }
    }
  }

  return (config: Configuration) => config
}

export async function loadCommandConfig(
  projectPath: string,
  command: 'dev' | 'build' | 'start' | 'preview'
) {
  const userConfigPath = path.join(projectPath, 'extension.config.js')
  const moduleUserConfigPath = path.join(projectPath, 'extension.config.mjs')
  const configPath = fs.existsSync(userConfigPath)
    ? userConfigPath
    : moduleUserConfigPath

  if (fs.existsSync(userConfigPath) || fs.existsSync(moduleUserConfigPath)) {
    if (await isUsingExperimentalConfig(projectPath)) {
      try {
        const userConfig = await loadConfigFile(configPath)
        if (userConfig) {
          // @ts-expect-error - TS doesn't know that command is a key of FileConfig['commands']
          return userConfig[command]
        }
      } catch (err: unknown) {
        const error = err as Error
        console.error(`Error loading command config: ${error.message}`)
        throw err
      }
    }
  }

  return {}
}

export async function loadBrowserConfig(
  projectPath: string,
  browser: DevOptions['browser'] = 'chrome'
): Promise<BrowserConfig> {
  const userConfigPath = path.join(projectPath, 'extension.config.js')
  const moduleUserConfigPath = path.join(projectPath, 'extension.config.mjs')
  const configPath = fs.existsSync(userConfigPath)
    ? userConfigPath
    : moduleUserConfigPath

  if (fs.existsSync(userConfigPath) || fs.existsSync(moduleUserConfigPath)) {
    if (await isUsingExperimentalConfig(projectPath)) {
      try {
        const userConfig = await loadConfigFile(configPath)
        if (userConfig && userConfig.browser && userConfig.browser[browser]) {
          return userConfig.browser[browser] || {browser: 'chrome'}
        }
      } catch (err: unknown) {
        const error = err as Error
        console.error(`Error loading browser config: ${error.message}`)
        throw err
      }
    }
  }

  return {
    browser: 'chrome'
  }
}

let userMessageDelivered = false

export async function isUsingExperimentalConfig(projectPath: string) {
  const userConfigPath = path.join(projectPath, 'extension.config.js')
  const moduleUserConfigPath = path.join(projectPath, 'extension.config.mjs')
  const configPath = fs.existsSync(userConfigPath)
    ? userConfigPath
    : moduleUserConfigPath

  if (fs.existsSync(configPath) || fs.existsSync(moduleUserConfigPath)) {
    if (!userMessageDelivered) {
      console.log(messages.isUsingExperimentalConfig('extension.config.js'))
      userMessageDelivered = true
    }
    return true
  }
  return false
}
