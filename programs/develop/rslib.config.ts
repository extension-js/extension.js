import * as path from 'path'
import * as fs from 'fs'
import {defineConfig} from '@rslib/core'
import type {RslibConfig} from '@rslib/core'

function copyStaticFilesPlugin() {
  return {
    name: 'copy-static-files',
    setup(api: any) {
      api.onAfterBuild(() => {
        const sourceDir = path.resolve(
          __dirname,
          './webpack/plugin-reload/extensions'
        )
        const targetDir = path.resolve(__dirname, './dist/extensions')

        if (fs.existsSync(sourceDir)) {
          fs.mkdirSync(targetDir, {recursive: true})
          copyDirectory(sourceDir, targetDir)
          console.log(
            '[Extension.js setup] Extensions directory copied to dist/'
          )
        } else {
          console.warn(
            '[Extension.js setup] Extensions directory not found:',
            sourceDir
          )
        }
      })
    }
  }
}

function copyDirectory(source: string, target: string): void {
  if (!fs.existsSync(target)) fs.mkdirSync(target, {recursive: true})

  for (const item of fs.readdirSync(source)) {
    const sourcePath = path.join(source, item)
    const targetPath = path.join(target, item)

    if (fs.statSync(sourcePath).isDirectory()) {
      copyDirectory(sourcePath, targetPath)
    } else {
      fs.copyFileSync(sourcePath, targetPath)
    }
  }
}

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
  ],
  plugins: [copyStaticFilesPlugin()]
} satisfies RslibConfig)
