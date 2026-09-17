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
const shouldGenerateDts = (() => {
  try {
    require('@ast-grep/napi')

    return true
  } catch (_error) {
    // If the native binding cannot load, skip d.ts generation and keep build working.
    // eslint-disable-next-line no-console
    console.warn(
      '[Extension.js] Skipping d.ts generation: @ast-grep/napi failed to load.'
    )

    return false
  }
})()

function copyReadmePlugin() {
  return {
    name: 'copy-readme',
    setup(api: {onAfterBuild: (cb: () => void) => void}) {
      api.onAfterBuild(() => {
        const {stale, target} = syncNpmReadme()
        console.log(
          `${colors.gray('⏵⏵⏵ system')} [Extension.js setup] ${stale ? `File README.md copied to ${target}` : "File README.md haven't changed. Skipping copy..."}`
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
