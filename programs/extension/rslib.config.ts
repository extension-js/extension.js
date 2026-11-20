//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {createRequire} from 'node:module'
import * as path from 'node:path'
import type {RslibConfig} from '@rslib/core'
import {defineConfig} from '@rslib/core'
import colors from 'pintor'
// @ts-expect-error plain ESM script without types, shared with the README sync workflow
import {syncNpmReadme} from '../../scripts/sync-npm-readme.mjs'

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

function copyReadmePlugin() {
  return {
    name: 'copy-readme',
    setup(api: {onAfterBuild: (cb: () => void) => void}) {
      api.onAfterBuild(() => {
        const {stale, target} = syncNpmReadme()

        // An unchanged README is the usual case and says nothing.
        if (!stale) return

        console.log(
          `${colors.gray('⏵⏵⏵ system')} [Extension.js setup] File README.md copied to ${target}`
        )
      })
    }
  }
}

export default defineConfig({
  source: {
    entry: {
      cli: path.resolve(__dirname, './index.ts'),
      browsers: path.resolve(__dirname, './browsers/index.ts')
    }
  },
  lib: [
    {
      format: 'cjs',
      syntax: 'es2021',
      dts: shouldGenerateDts
    }
  ],
  plugins: [copyReadmePlugin()]
} satisfies RslibConfig)
