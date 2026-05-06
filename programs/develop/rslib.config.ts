// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as path from 'path'
import {defineConfig} from '@rslib/core'
import type {RslibConfig} from '@rslib/core'

const externals = [
  // React / Preact
  'react-refresh',
  '@rspack/plugin-react-refresh',
  '@rspack/plugin-preact-refresh',
  '@prefresh/core',
  '@prefresh/utils',
  '@prefresh/webpack',

  // Vue / Svelte
  'vue-loader',
  '@vue/compiler-sfc',
  'vue-style-loader',
  'svelte-loader',

  // Style loaders
  'sass-loader',
  'less-loader',
  'postcss-loader',
  'postcss-preset-env'
]

// Browser-side runtime files: HMR shims and minimum placeholder scripts.
// These are emitted as standalone assets and end up running INSIDE the
// user's extension at runtime (HTML page scripts, content scripts, service
// workers). They MUST NOT receive the Node-only `createRequire` banner —
// `node:module` is unresolvable in a web target and causes "Reading from
// 'node:module' is not handled by plugins" when rspack later bundles user
// code that pulls these wrappers in as content/background entries.
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
    './plugin-web-extension/feature-scripts/steps/setup-reload-strategy/add-content-script-wrapper/main-world-bridge.js'
  ),
  'minimum-chromium-file': path.resolve(
    __dirname,
    './plugin-web-extension/feature-scripts/scripts-lib/minimum-files/minimum-background-file-chromium.ts'
  ),
  'minimum-firefox-file': path.resolve(
    __dirname,
    './plugin-web-extension/feature-scripts/scripts-lib/minimum-files/minimum-background-file-firefox.ts'
  )
}

// Node-side: the main library entry, the preview entry, plus rspack loaders
// (resolve-paths-loader, ensure-hmr-for-scripts, feature-scripts-content-
// script-wrapper). Loaders execute inside rspack's loader runner at build
// time, so they live on Node and need the CJS-shim banner so bundled bare
// `require()` / `require.resolve()` sites keep working in pure ESM.
const nodeEntries = {
  module: path.resolve(__dirname, './module.ts'),
  preview: path.resolve(__dirname, './preview-entry.ts'),
  'resolve-paths-loader': path.resolve(
    __dirname,
    './plugin-web-extension/feature-resolve/loader/index.ts'
  ),
  'ensure-hmr-for-scripts': path.resolve(
    __dirname,
    './plugin-web-extension/feature-html/steps/ensure-hmr-for-scripts.ts'
  ),
  'feature-scripts-content-script-wrapper': path.resolve(
    __dirname,
    './plugin-web-extension/feature-scripts/steps/setup-reload-strategy/add-content-script-wrapper/content-script-wrapper.ts'
  )
}

export default defineConfig({
  tools: {
    // Disable caching to avoid rspack module graph panics in CI builds.
    rspack: {
      cache: false,
      // Polyfill CJS globals in ESM output (target: node). Source files that
      // compute paths via `__dirname` / `__filename` (e.g. develop-context,
      // package-manager) would otherwise hit ReferenceError after the ESM
      // flip. The `node-module` mode replaces them via `import.meta.url`.
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
      source: {entry: nodeEntries},
      // Inject a CJS-style `require` so bundled bare `require(...)` /
      // `require.resolve(...)` sites in Node-side code keep working in pure
      // ESM. createRequire is not available as a global in ESM. Limited to
      // node-target lib so browser-side wrappers don't pick up `node:module`.
      banner: {
        js: 'import { createRequire as __extjsCreateRequire } from "node:module"; const require = __extjsCreateRequire(import.meta.url);'
      },
      output: {
        target: 'node',
        // Emit ESM-aware polyfills for CJS-only globals so source files that
        // use `__dirname` / `__filename` keep working after the format flip
        // to ESM. Without this, references blow up at runtime as
        // `ReferenceError`.
        filename: {js: '[name].mjs'},
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
    }
  ],
  plugins: []
} satisfies RslibConfig)
