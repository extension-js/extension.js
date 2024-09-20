import fs from 'fs'
import path from 'path'
import {Configuration} from 'webpack'
import {FileConfig} from './config-types'
import {DevOptions} from '../../commands/dev'
import * as messages from './messages'

export function loadExtensionConfig(projectPath: string) {
  const userConfigPath = path.join(projectPath, 'extension.config.js')

  if (fs.existsSync(userConfigPath)) {
    if (isUsingExperimentalConfig(projectPath)) {
      const userConfig: FileConfig = require(userConfigPath)
      if (userConfig && userConfig != null) {
        if (userConfig && typeof userConfig!.config === 'function') {
          return userConfig!.config
        }
      }
    }
  }

  return (config: Configuration) => config
}

export function loadCommandConfig(
  projectPath: string,
  command: 'dev' | 'build' | 'start' | 'preview'
) {
  const userConfigPath = path.join(projectPath, 'extension.config.js')

  if (fs.existsSync(userConfigPath)) {
    if (isUsingExperimentalConfig(projectPath)) {
      const userConfig: any = require(userConfigPath)
      if (userConfig && userConfig != null) {
        return userConfig![command]
      }
    }
  }

  return {}
}

export function loadBrowserConfig(
  projectPath: string,
  browser: DevOptions['browser']
) {
  const userConfigPath = path.join(projectPath, 'extension.config.js')

  if (fs.existsSync(userConfigPath)) {
    if (isUsingExperimentalConfig(projectPath)) {
      const userConfig: any = require(userConfigPath)
      if (userConfig && userConfig.browsers != null) {
        return userConfig.browsers![browser]
      }
    }
  }

  return {}
}

let userMessageDelivered = false

export function isUsingExperimentalConfig(projectPath: string) {
  const configPath = path.join(projectPath, 'extension.config.js')
  if (fs.existsSync(configPath)) {
    if (!userMessageDelivered) {
      console.log(messages.isUsingExperimentalConfig('extension.config.js'))
      userMessageDelivered = true
    }
    return true
  } else {
    return false
  }
}
