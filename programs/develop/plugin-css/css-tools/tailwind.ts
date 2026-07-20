//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import colors from 'pintor'
import {hasDependency} from '../../lib/has-dependency'
import * as messages from '../css-lib/messages'

let userMessageDelivered = false

export function isUsingTailwind(projectPath: string) {
  const isUsingTailwind =
    hasDependency(projectPath, 'tailwindcss') ||
    hasDependency(projectPath, '@tailwindcss/postcss')

  if (isUsingTailwind) {
    if (!userMessageDelivered) {
      if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
        console.log(
          `${colors.brightMagenta('⏵⏵⏵ Author says')} ${messages.isUsingIntegration('Tailwind')}`
        )
      }
      userMessageDelivered = true
    }
  }

  return isUsingTailwind
}

export function getTailwindConfigFile(projectPath: string) {
  const candidates = [
    'tailwind.config.mjs',
    'tailwind.config.cjs',
    'tailwind.config.ts',
    'tailwind.config.js'
  ]

  for (const candidate of candidates) {
    const configPath = path.join(projectPath, candidate)
    if (fs.existsSync(configPath)) return configPath
  }

  return undefined
}
