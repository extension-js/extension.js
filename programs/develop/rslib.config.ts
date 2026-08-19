// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {createRequire} from 'node:module'
import * as path from 'node:path'
import type {RslibConfig} from '@rslib/core'
import {defineConfig} from '@rslib/core'

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

const externals = [
  'react-refresh',
  '@rspack/plugin-react-refresh',
  '@rspack/plugin-preact-refresh',
  '@prefresh/core',
  '@prefresh/utils',
  '@prefresh/webpack',

  'vue-loader',
  '@vue/compiler-sfc',
  'vue-style-loader',
  'svelte-loader',

  'sass-loader',
  'less-loader',
  'postcss-loader',
  'postcss-preset-env',

  // Agent-bridge control WS (Node-side, required at runtime)
  'ws'
]

// Browser-side runtime files run INSIDE the user's extension; they must not
// receive the Node-only createRequire banner (node:module is unresolvable there).
const browserEntries = {
  'minimum-script-file': path.resolve(
    __dirname,
    './plugin-web-extension/feature-html/steps/minimum-script-file.ts'
  ),
  'preact-refresh-shim': path.resolve(
    __dirname,
    './plugin-web-extension/feature-html/steps/preact-refresh-shim.ts'
  ),
  // MAIN world bridge helper (must exist on disk for manifest/script validation during builds)
  'main-world-bridge': path.resolve(
    __dirname,
    './plugin-web-extension/feature-scripts/steps/add-content-script-wrapper/main-world-bridge.js'
  ),
  'minimum-chromium-file': path.resolve(
    __dirname,
    './plugin-reload/reload-lib/minimum-files/minimum-background-file-chromium.ts'
  ),
  'minimum-firefox-file': path.resolve(
    __dirname,
    './plugin-reload/reload-lib/minimum-files/minimum-background-file-firefox.ts'
  )
}

// The canonical machine contract lives in the extension program's spec tree;
// the published package ships a byte-for-byte copy under dist/contract.
const contractDir = path.resolve(__dirname, '../extension/__spec__/contract')

// Node-side entries and rspack loaders run at build time on Node, so they need
// the CJS-shim banner for bundled bare require()/require.resolve() sites.
const nodeEntries = {
  module: path.resolve(__dirname, './module.ts'),
  preview: path.resolve(__dirname, './preview-entry.ts'),
  bridge: path.resolve(__dirname, './bridge-entry.ts'),
  'ensure-hmr-for-scripts': path.resolve(
    __dirname,
    './plugin-web-extension/feature-html/steps/ensure-hmr-for-scripts.ts'
  ),
  'feature-scripts-content-script-wrapper': path.resolve(
    __dirname,
    './plugin-web-extension/feature-scripts/steps/add-content-script-wrapper/content-script-wrapper.ts'
  ),
  'feature-scripts-classic-concat-loader': path.resolve(
    __dirname,
    './plugin-web-extension/feature-scripts/steps/add-content-script-wrapper/classic-concat-loader.ts'
  ),
  'feature-scripts-native-geturl-import-loader': path.resolve(
    __dirname,
    './plugin-web-extension/feature-scripts/steps/native-geturl-import-loader.ts'
  ),
  'css-parse-guard-loader': path.resolve(
    __dirname,
    './plugin-css/css-parse-guard-loader.ts'
  ),
  'late-css-import-loader': path.resolve(
    __dirname,
    './plugin-css/late-css-import-loader.ts'
  ),
  'preprocessor-passthrough-loader': path.resolve(
    __dirname,
    './plugin-css/preprocessor-passthrough-loader.ts'
  )
}

export default defineConfig({
  tools: {
    // Disable caching to avoid rspack module graph panics in CI builds.
    rspack: {
      cache: false,
      // Polyfill CJS globals in ESM output (target: node): __dirname/__filename
      // would otherwise hit ReferenceError after the ESM flip.
      node: {
        __dirname: 'node-module',
        __filename: 'node-module'
      }
    }
  },
  lib: [
    {
      format: 'esm',
      syntax: 'es2022',
      dts: shouldGenerateDts,
      source: {entry: nodeEntries},
      // Inject a CJS-style require for bundled bare require() sites in Node-side
      // code; limited to node-target lib so browser wrappers skip node:module.
      banner: {
        js: 'import { createRequire as __extjsCreateRequire } from "node:module"; const require = __extjsCreateRequire(import.meta.url);'
      },
      output: {
        target: 'node',
        // Emit ESM-aware polyfills for __dirname/__filename so they keep working
        // after the format flip to ESM.
        filename: {js: '[name].mjs'},
        // Ship the contract JSON (schema plus any golden envelopes) so the MCP
        // can byte-compare against node_modules/extension-develop/dist/contract.
        copy: [
          {
            from: contractDir,
            to: 'contract',
            globOptions: {ignore: ['**/*.ts']}
          }
        ],
        externals
      }
    },
    {
      format: 'esm',
      syntax: 'es2022',
      source: {entry: browserEntries},
      output: {
        target: 'web',
        filename: {js: '[name].mjs'},
        externals
      }
    },
    // Wire constants and frame types only, web target and no banner, so the
    // emitted chunk imports nothing and browser bundles can consume it.
    {
      format: 'esm',
      syntax: 'es2022',
      dts: shouldGenerateDts,
      source: {
        entry: {contracts: path.resolve(__dirname, './contracts-entry.ts')}
      },
      output: {
        target: 'web',
        filename: {js: '[name].mjs'}
      }
    }
  ],
  plugins: []
} satisfies RslibConfig)
