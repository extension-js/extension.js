import * as path from 'path'
import {defineConfig} from '@rslib/core'

export default defineConfig({
  source: {
    entry: {
      module: path.resolve(__dirname, './module.ts'),
      // HTML Plugin Loaders
      'ensure-hmr-for-scripts': path.resolve(
        __dirname,
        './webpack/plugin-extension/feature-html/steps/ensure-hmr-for-scripts.ts'
      ),
      // Scripts Plugin Loaders
      'add-hmr-accept-code': path.resolve(
        __dirname,
        './webpack/plugin-extension/feature-scripts/steps/add-hmr-accept-code.ts'
      ),
      'deprecated-shadow-root': path.resolve(
        __dirname,
        './webpack/plugin-extension/feature-scripts/steps/deprecated-shadow-root.ts'
      ),
      // Reload Plugin Loaders
      'inject-chromium-client-loader': path.resolve(
        __dirname,
        './webpack/plugin-reload/steps/setup-chromium-reload-client/inject-chromium-client-loader.ts'
      ),
      'inject-firefox-client-loader': path.resolve(
        __dirname,
        './webpack/plugin-reload/steps/setup-firefox-reload-client/inject-firefox-client-loader.ts'
      ),
      // Minimum files
      'minimum-content-file': path.resolve(
        __dirname,
        './webpack/plugin-extension/feature-scripts/steps/minimum-content-file.ts'
      ),
      'minimum-chromium-file': path.resolve(
        __dirname,
        './webpack/plugin-reload/steps/setup-chromium-reload-client/minimum-chromium-file.ts'
      ),
      'minimum-firefox-file': path.resolve(
        __dirname,
        './webpack/plugin-reload/steps/setup-firefox-reload-client/minimum-firefox-file.ts'
      ),
      'minimum-script-file': path.resolve(
        __dirname,
        './webpack/plugin-extension/feature-html/steps/minimum-script-file.ts'
      )
    }
  },
  lib: [
    {
      format: 'cjs',
      syntax: 'es2021',
      dts: true
    }
  ]
})
