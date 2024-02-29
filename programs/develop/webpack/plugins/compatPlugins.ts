// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import path from 'path'
import type webpack from 'webpack'
import PolyfillPlugin from 'webpack-browser-extension-polyfill'
import ManifestCompatPlugin from 'webpack-browser-extension-manifest-compat'
import {type DevOptions} from '../../extensionDev'

export default function compatPlugins(
  projectPath: string,
  {polyfill, browser}: DevOptions
) {
  return {
    name: 'CompatPlugin',
    apply: (compiler: webpack.Compiler) => {
      const manifestPath = path.resolve(projectPath, 'manifest.json')

      // Allow browser polyfill as needed
      if (polyfill) {
        if (browser !== 'firefox') {
          new PolyfillPlugin({
            manifestPath,
            browser
          }).apply(compiler)
        }
      }

      // Handle manifest compatibilities across browser vendors.
      new ManifestCompatPlugin({
        manifestPath,
        browser
      }).apply(compiler)
    }
  }
}
