import path from 'path'
import type webpack from 'webpack'
import SpecialFoldersPlugin from './SpecialFoldersPlugin'

import {type DevOptions} from '../../extensionDev'

export default function boringPlugins(projectPath: string, {mode}: DevOptions) {
  const project = require(`${projectPath}/manifest.json`)
  const projectName = project.name
  const projectVersion = project.version

  return {
    name: 'BoringPlugin',
    apply: (compiler: webpack.Compiler) => {
      compiler.hooks.done.tap('BoringPlugin', (stats) => {
        const divider = stats.hasErrors() ? '✖︎✖︎✖︎' : '►►►'
        stats.compilation.name = `🧩 extension-create ${divider} ${projectName} (v${projectVersion})`
      })

      new SpecialFoldersPlugin({
        manifestPath: path.join(projectPath, 'manifest.json')
      }).apply(compiler)
    }
  }
}
