//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {debugLine, isDebug, prefix} from '../../lib/messaging'
import {hasProjectDependency} from '../../lib/project-manifest'
import * as messages from '../css-lib/messages'

let userMessageDelivered = false

export function isUsingTailwind(projectPath: string) {
  const isUsingTailwind =
    hasProjectDependency(projectPath, 'tailwindcss') ||
    hasProjectDependency(projectPath, '@tailwindcss/postcss')

  if (isUsingTailwind) {
    if (!userMessageDelivered) {
      if (isDebug()) {
        debugLine(
          `${prefix('debug')} ${messages.isUsingIntegration('Tailwind')}`
        )
      }

      userMessageDelivered = true
    }
  }

  return isUsingTailwind
}

export const TAILWIND_CONFIG_NAMES = [
  'tailwind.config.mjs',
  'tailwind.config.cjs',
  'tailwind.config.ts',
  'tailwind.config.js'
]

export function getTailwindConfigFile(projectPath: string) {
  for (const candidate of TAILWIND_CONFIG_NAMES) {
    const configPath = path.join(projectPath, candidate)
    if (fs.existsSync(configPath)) return configPath
  }

  return undefined
}
