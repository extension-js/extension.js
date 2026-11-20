//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {createRequire} from 'node:module'
import * as path from 'node:path'
import {defineConfig} from '@rslib/core'

const require = createRequire(import.meta.url)

// Declarations are part of what ships, so a build that cannot write them
// stops. EXTENSION_SKIP_DTS=1 is the stated way to build without them.
export function resolveDtsGeneration(
  load: () => unknown,
  env: Record<string, string | undefined> = process.env
): boolean {
  if (env.EXTENSION_SKIP_DTS === '1') return false

  try {
    load()

    return true
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)

    throw new Error(
      [
        '[Extension.js] Type declarations cannot be generated: @ast-grep/napi failed to load.',
        reason.split('\n')[0],
        'Reinstall the dependencies, or set EXTENSION_SKIP_DTS=1 to build without declarations.'
      ].join('\n')
    )
  }
}

const shouldGenerateDts = resolveDtsGeneration(() => require('@ast-grep/napi'))

export default defineConfig({
  source: {
    entry: {
      module: path.resolve(__dirname, './module.ts')
    }
  },
  lib: [
    {
      format: 'cjs',
      syntax: 'es2021',
      dts: shouldGenerateDts
    }
  ]
})
