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
      'add-centralized-logger-script': path.resolve(
        __dirname,
        './webpack/plugin-extension/feature-html/steps/add-centralized-logger-script.ts'
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
      'add-centralized-logger-script-background': path.resolve(
        __dirname,
        './webpack/plugin-extension/feature-scripts/steps/add-centralized-logger-script/logger-background.ts'
      ),
      'add-centralized-logger-script-content': path.resolve(
        __dirname,
        './webpack/plugin-extension/feature-scripts/steps/add-centralized-logger-script/logger-script.ts'
      ),
      'minimum-chromium-file': path.resolve(
        __dirname,
        './webpack/plugin-extension/feature-scripts/scripts-lib/minimum-files/minimum-background-file-chromium.ts'
      ),
      'minimum-firefox-file': path.resolve(
        __dirname,
        './webpack/plugin-extension/feature-scripts/scripts-lib/minimum-files/minimum-background-file-firefox.ts'
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
} satisfies RslibConfig)
