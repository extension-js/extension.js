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
      // Lightweight preview-only entry (no rspack / heavy build deps)
      preview: path.resolve(__dirname, './preview-entry.ts'),
      // HTML Plugin Loaders
      'ensure-hmr-for-scripts': path.resolve(
        __dirname,
        './plugin-web-extension/feature-html/steps/ensure-hmr-for-scripts.ts'
      ),
      'minimum-script-file': path.resolve(
        __dirname,
        './plugin-web-extension/feature-html/steps/minimum-script-file.ts'
      ),
      'preact-refresh-shim': path.resolve(
        __dirname,
        './plugin-web-extension/feature-html/steps/preact-refresh-shim.ts'
      ),
      // Scripts Plugin Loaders
      'feature-scripts-content-script-wrapper': path.resolve(
        __dirname,
        './plugin-web-extension/feature-scripts/steps/setup-reload-strategy/add-content-script-wrapper/content-script-wrapper.ts'
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
      ),
      // Resolve Plugin Loaders
      'resolve-paths-loader': path.resolve(
        __dirname,
        './plugin-web-extension/feature-resolve/loader/index.ts'
      )
    }
  },
  tools: {
    // Disable caching to avoid rspack module graph panics in CI builds.
    rspack: {
      cache: false
    }
  },
  lib: [
    {
      format: 'cjs',
      syntax: 'es2021',
      // Toolchain packages ship with extension-develop but stay external to the
      // compiled bundle; they are loaded at runtime via Node resolution.
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
          'postcss-preset-env'
        ]
      }
      // dts: true
    }
  ],
  plugins: []
} satisfies RslibConfig)
