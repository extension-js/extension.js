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
import {resolveDtsGeneration} from '../../scripts/lib/dts-generation.mjs'
// @ts-expect-error plain ESM script without types, shared with the README sync workflow
import {syncNpmReadme} from '../../scripts/sync-npm-readme.mjs'

const require = createRequire(import.meta.url)
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
