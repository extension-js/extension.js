// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import path from 'path'
import os from 'os'
import type webpack from 'webpack'
import RunChromeExtension from 'webpack-run-chrome-extension'
import RunEdgeExtension from 'webpack-run-edge-extension'
import RunFirefoxAddon from 'webpack-run-firefox-addon'
import {type DevOptions} from '../../extensionDev'
import {getManifestPath, getOutputPath} from '../config/getPath'

function getProfilePath(devOptions: DevOptions) {
  if (devOptions?.userDataDir) {
    return devOptions.userDataDir
  }

  // Ensure `start` runs in a fresh profile by default.
  if (devOptions.mode === 'production') {
    return path.join(
      os.tmpdir(),
      'extension-js',
      devOptions.browser!,
      'profile'
    )
  }

  return devOptions?.userDataDir
}

export default function browserPlugins(
  projectPath: string,
  devOptions: DevOptions
) {
  if (!devOptions?.mode || process.env.NODE_ENV === 'test') {
    return {
      constructor: {name: 'BrowserPlugin'},
      apply: () => {}
    }
  }

  const chromeConfig = {
    port: 8000,
    manifestPath: getManifestPath(projectPath),
    // The final folder where the extension manifest file is located.
    // This is used to load the extension into the browser.
    extensionPath: getOutputPath(projectPath, devOptions.browser),
    autoReload: true,
    browserFlags: ['--enable-benchmarking'],
    userDataDir: getProfilePath(devOptions),
    stats: true
  }

  const edgeConfig = {
    ...chromeConfig,
    port: 8001,
    stats: true
  }

  const firefoxConfig = {
    ...chromeConfig,
    port: 8002,
    // If all browsers are being used, we don't need to show the stats
    // for each browser. This is because the stats will be the same for
    // each browser.
    // Note that a comma means that more than once browser is selected,
    // so we show the user extension manifest output only once.
    stats: true
  }

  return {
    constructor: {name: 'BrowserPlugin'},
    apply: (compiler: webpack.Compiler) => {
      switch (devOptions.browser) {
        case 'chrome':
          new RunChromeExtension(chromeConfig).apply(compiler)
          break
        case 'edge':
          new RunEdgeExtension(edgeConfig).apply(compiler)
          break
        case 'firefox':
          new RunFirefoxAddon(firefoxConfig).apply(compiler)
          break
        default:
          new RunChromeExtension(chromeConfig).apply(compiler)
          break
      }
    }
  }
}
