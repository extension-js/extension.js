import fs from 'fs'
import path from 'path'
import {Configuration} from 'webpack'
import {FileConfig} from './config-types'
import * as messages from './messages'

export function loadExtensionConfig(projectPath: string) {
  const userConfigPath = path.join(projectPath, 'extension.config.js')

  if (fs.existsSync(userConfigPath)) {
    if (isUsingExtensionConfig(projectPath)) {
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

export function isUsingExtensionConfig(projectPath: string) {
  const configPath = path.join(projectPath, 'extension.config.js')
  if (fs.existsSync(configPath)) {
    console.log(messages.isUsingExtensionConfig('extension.config.js'))
    return true
  } else {
    return false
  }
}
