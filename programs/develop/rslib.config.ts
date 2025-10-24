import * as path from 'path'
import * as fs from 'fs'
import {defineConfig} from '@rslib/core'
import type {RslibConfig} from '@rslib/core'

function copyDevtoolsDistPlugin() {
  function copyDir(src: string, dest: string) {
    if (!fs.existsSync(src)) return
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, {recursive: true})

    const entries = fs.readdirSync(src, {withFileTypes: true})

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name)
      const destPath = path.join(dest, entry.name)

      if (entry.isDirectory()) {
        copyDir(srcPath, destPath)
      } else if (entry.isSymbolicLink()) {
        try {
          const real = fs.realpathSync(srcPath)
          const data = fs.readFileSync(real)
          fs.writeFileSync(destPath, data)
        } catch {
          // Ignore
        }
      } else {
        fs.copyFileSync(srcPath, destPath)
      }
    }
  }

  return {
    name: 'copy-devtools-dist',
    setup(api: any) {
      api.onAfterBuild(() => {
        try {
          // Find devtools dist root. Some builds emit to dist/, others to src/dist/.
          const devtoolsRootCandidates = [
            path.resolve(
              __dirname,
              '../../extensions/extension-js-devtools/dist'
            ),
            path.resolve(
              __dirname,
              '../../extensions/extension-js-devtools/src/dist'
            )
          ]
          const devtoolsRoot = devtoolsRootCandidates.find((candidate) =>
            fs.existsSync(candidate)
          )
          if (!devtoolsRoot) return
          // Copy ONLY dist/chrome and dist/firefox, mirroring into
          // programs/develop/dist/extension-js-devtools/{chrome,firefox}
          const targets = ['chrome', 'firefox']
          const developDist = path.resolve(
            __dirname,
            './dist/extension-js-devtools'
          )
          if (!fs.existsSync(developDist))
            fs.mkdirSync(developDist, {recursive: true})

          for (const folder of targets) {
            const src = path.join(devtoolsRoot, folder)
            const dest = path.join(developDist, folder)
            if (fs.existsSync(src)) {
              copyDir(src, dest)
            }
          }
        } catch {
          // Ignore
        }
      })
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
  ],
  plugins: [copyDevtoolsDistPlugin()]
} satisfies RslibConfig)
