import fs from 'fs'
import path from 'path'
import {Configuration} from '@rspack/core'
import {BrowserConfig, FileConfig} from './config-types'
import {DevOptions} from '../../commands/commands-lib/config-types'
import * as messages from './messages'

export async function loadCustomWebpackConfig(projectPath: string) {
  const userConfigPath = path.join(projectPath, 'extension.config.js')

  if (fs.existsSync(userConfigPath)) {
    if (await isUsingExperimentalConfig(projectPath)) {
      const userConfig: FileConfig = require(userConfigPath)
      if (userConfig && typeof userConfig.config === 'function') {
        return userConfig.config
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

  if (fs.existsSync(userConfigPath)) {
    if (await isUsingExperimentalConfig(projectPath)) {
      const userConfig: FileConfig = require(userConfigPath)
      if (userConfig) {
        // @ts-expect-error - TS doesn't know that command is a key of FileConfig['commands']
        return userConfig[command]
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

  if (fs.existsSync(userConfigPath)) {
    if (await isUsingExperimentalConfig(projectPath)) {
      const userConfig: FileConfig = require(userConfigPath)
      if (userConfig && userConfig.browser && userConfig.browser[browser]) {
        return userConfig.browser[browser] || {browser: 'chrome'}
      }
    }
  }

  return {
    browser: 'chrome'
  }
}

let userMessageDelivered = false

export async function isUsingExperimentalConfig(projectPath: string) {
  const configPath = path.join(projectPath, 'extension.config.js')
  if (fs.existsSync(configPath)) {
    if (!userMessageDelivered) {
      console.log(messages.isUsingExperimentalConfig('extension.config.js'))
      userMessageDelivered = true
    }
    return true
  }
  return false
}
