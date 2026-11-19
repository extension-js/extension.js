//      ██╗███████╗      ███████╗██████╗  █████╗ ███╗   ███╗███████╗██╗    ██╗ ██████╗ ██████╗ ██╗  ██╗███████╗
//      ██║██╔════╝      ██╔════╝██╔══██╗██╔══██╗████╗ ████║██╔════╝██║    ██║██╔═══██╗██╔══██╗██║ ██╔╝██╔════╝
//      ██║███████╗█████╗█████╗  ██████╔╝███████║██╔████╔██║█████╗  ██║ █╗ ██║██║   ██║██████╔╝█████╔╝ ███████╗
// ██   ██║╚════██║╚════╝██╔══╝  ██╔══██╗██╔══██║██║╚██╔╝██║██╔══╝  ██║███╗██║██║   ██║██╔══██╗██╔═██╗ ╚════██║
// ╚█████╔╝███████║      ██║     ██║  ██║██║  ██║██║ ╚═╝ ██║███████╗╚███╔███╔╝╚██████╔╝██║  ██║██║  ██╗███████║
//  ╚════╝ ╚══════╝      ╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝╚══════╝ ╚══╝╚══╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {parseJsoncSafe} from '../../lib/project-manifest'
import {resolveExtends} from '../../lib/tsconfig-includes-file'

export type SwcDecoratorTransform =
  | {legacyDecorator: true; decoratorMetadata?: true}
  | {decoratorVersion: '2022-03'}

// The compilerOptions SWC can follow. Everything else in a tsconfig is
// type checking or module resolution, which the bundler owns.
const TRANSFORM_FLAGS = [
  'experimentalDecorators',
  'emitDecoratorMetadata',
  'jsxImportSource',
  'useDefineForClassFields'
] as const

export type TransformFlags = Partial<
  Record<(typeof TRANSFORM_FLAGS)[number], unknown>
>

// The nearest config wins over what it extends, and a later entry of an
// extends array over an earlier one. An unreadable file adds nothing.
export function readTransformFlags(
  configPath: string,
  seen: Set<string> = new Set()
): TransformFlags {
  if (seen.has(configPath)) return {}

  seen.add(configPath)

  let config: {extends?: unknown; compilerOptions?: Record<string, unknown>}

  try {
    config = parseJsoncSafe(
      fs.readFileSync(configPath, 'utf-8')
    ) as typeof config
  } catch {
    return {}
  }

  const bases = [config?.extends]
    .flat()
    .filter((value) => typeof value === 'string')
  let flags: TransformFlags = {}

  for (const base of bases) {
    const basePath = resolveExtends(base as string, path.dirname(configPath))
    if (basePath) flags = {...flags, ...readTransformFlags(basePath, seen)}
  }

  const own = config?.compilerOptions || {}

  for (const key of TRANSFORM_FLAGS) {
    if (key in own) flags = {...flags, [key]: own[key]}
  }

  return flags
}

// TypeScript's experimentalDecorators means the legacy proposal, with
// metadata only when emitDecoratorMetadata asks. Anything else is standard.
export function swcDecoratorTransform(
  configPath: string | undefined
): SwcDecoratorTransform {
  const flags = configPath ? readTransformFlags(configPath) : {}

  if (flags.experimentalDecorators !== true) {
    return {decoratorVersion: '2022-03'}
  }

  return flags.emitDecoratorMetadata === true
    ? {legacyDecorator: true, decoratorMetadata: true}
    : {legacyDecorator: true}
}
