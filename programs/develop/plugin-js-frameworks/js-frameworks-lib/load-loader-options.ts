//      ██╗███████╗      ███████╗██████╗  █████╗ ███╗   ███╗███████╗██╗    ██╗ ██████╗ ██████╗ ██╗  ██╗███████╗
//      ██║██╔════╝      ██╔════╝██╔══██╗██╔══██╗████╗ ████║██╔════╝██║    ██║██╔═══██╗██╔══██╗██║ ██╔╝██╔════╝
//      ██║███████╗█████╗█████╗  ██████╔╝███████║██╔████╔██║█████╗  ██║ █╗ ██║██║   ██║██████╔╝█████╔╝ ███████╗
// ██   ██║╚════██║╚════╝██╔══╝  ██╔══██╗██╔══██║██║╚██╔╝██║██╔══╝  ██║███╗██║██║   ██║██╔══██╗██╔═██╗ ╚════██║
// ╚█████╔╝███████║      ██║     ██║  ██║██║  ██║██║ ╚═╝ ██║███████╗╚███╔███╔╝╚██████╔╝██║  ██║██║  ██╗███████║
//  ╚════╝ ╚══════╝      ╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝╚══════╝ ╚══╝╚══╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {pathToFileURL} from 'node:url'
import {debugLine, isDebug} from '../../lib/messaging'
import type {AnyModule} from '../../lib/optional-deps-resolver'
import * as messages from './messages'

// Printed once per process. A caller that needs its own record passes one.
const customLoaderNotice = {delivered: false}

export function resolveLoaderConfigPath(
  projectPath: string,
  framework: 'vue' | 'svelte'
) {
  const candidates = [
    path.join(projectPath, `${framework}.loader.ts`),
    path.join(projectPath, `${framework}.loader.mts`),
    path.join(projectPath, `${framework}.loader.js`),
    path.join(projectPath, `${framework}.loader.mjs`)
  ]

  return candidates.find((p) => fs.existsSync(p)) || null
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// One level deep, user keys winning. A top-level spread let a project that set
// `compilerOptions.runes` drop the `dev` flag the build mode had just decided.
export function mergeLoaderOptions(
  defaults: Record<string, unknown>,
  custom: AnyModule
): Record<string, unknown> {
  if (!isPlainObject(custom)) return {...defaults}

  const merged: Record<string, unknown> = {...defaults, ...custom}

  for (const [key, value] of Object.entries(custom)) {
    if (isPlainObject(defaults[key]) && isPlainObject(value)) {
      merged[key] = {...(defaults[key] as Record<string, unknown>), ...value}
    }
  }

  return merged
}

export async function loadLoaderOptions(
  projectPath: string,
  framework: 'vue' | 'svelte',
  notice: {delivered: boolean} = customLoaderNotice
): Promise<AnyModule> {
  const configPath = resolveLoaderConfigPath(projectPath, framework)

  if (configPath) {
    if (!notice.delivered && isDebug()) {
      const display = path.basename(configPath)
      debugLine(messages.isUsingCustomLoader(display))
      notice.delivered = true
    }

    try {
      const module = await import(pathToFileURL(configPath).href)

      return module.default || module
    } catch (err: unknown) {
      const error = err as Error
      console.error(
        `Error loading ${framework} loader options: ${error.message}`
      )

      throw err
    }
  }

  return null
}
