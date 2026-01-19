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

export default defineConfig({
  source: {
    entry: {
      module: path.resolve(__dirname, './module.ts'),
      // HTML Plugin Loaders
      'ensure-hmr-for-scripts': path.resolve(
        __dirname,
        './webpack/plugin-extension/feature-html/steps/ensure-hmr-for-scripts.ts'
      ),
      'minimum-script-file': path.resolve(
        __dirname,
        './webpack/plugin-extension/feature-html/steps/minimum-script-file.ts'
      ),
      // Scripts Plugin Loaders
      'add-hmr-accept-code': path.resolve(
        __dirname,
        './webpack/plugin-extension/feature-scripts/steps/setup-reload-strategy/add-content-script-wrapper/add-hmr-accept-code.ts'
      ),
      'content-script-wrapper': path.resolve(
        __dirname,
        './webpack/plugin-extension/feature-scripts/steps/setup-reload-strategy/add-content-script-wrapper/content-script-wrapper.ts'
      ),
      'warn-no-default-export': path.resolve(
        __dirname,
        './webpack/plugin-extension/feature-scripts/steps/setup-reload-strategy/add-content-script-wrapper/warn-no-default-export.ts'
      ),
      // MAIN world bridge helper (must exist on disk for manifest/script validation during builds)
      'main-world-bridge': path.resolve(
        __dirname,
        './webpack/plugin-extension/feature-scripts/steps/setup-reload-strategy/add-content-script-wrapper/main-world-bridge.js'
      ),
      'minimum-chromium-file': path.resolve(
        __dirname,
        './webpack/plugin-extension/feature-scripts/scripts-lib/minimum-files/minimum-background-file-chromium.ts'
      ),
      'minimum-firefox-file': path.resolve(
        __dirname,
        './webpack/plugin-extension/feature-scripts/scripts-lib/minimum-files/minimum-background-file-firefox.ts'
      ),
      // Resolve Plugin Loaders
      'resolve-paths-loader': path.resolve(
        __dirname,
        './webpack/plugin-extension/feature-resolve/loader/index.ts'
      )
    }
  },
  lib: [
    {
      format: 'cjs',
      syntax: 'es2021',
      // These integrations are installed on-demand (or provided by the user project),
      // so they must remain runtime externals and never be bundled.
      output: {
        externals: [
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
          'postcss-preset-env',

          // JS loader
          'babel-loader'
        ]
      }
      // dts: true
    }
  ],
  plugins: []
} satisfies RslibConfig)
