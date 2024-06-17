// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import fs from 'fs'
import {DevOptions} from '../../extensionDev'

// https://webpack.js.org/configuration/devtool/
export default function getDevToolOption(
  projectPath: string,
  mode: DevOptions['mode']
) {
  const manifestPath = `${projectPath}/manifest.json`
  const manifestExists = fs.lstatSync(manifestPath)

  if (!manifestExists) {
    console.log(
      '🚨 - Error while developing the extension: manifest.json not found'
    )
    process.exit(1)
  }

  const manifest = require(manifestPath)

  if (mode === 'production') return undefined

  // MV3 doesn't allow eval.
  // Ref https://github.com/awesome-webextension/webpack-target-webextension/blob/master/examples/hmr-mv3/webpack.config.js#L7
  if (manifest.manifest_version === 3) {
    return 'cheap-source-map'
  }

  return 'eval-cheap-source-map'
}
