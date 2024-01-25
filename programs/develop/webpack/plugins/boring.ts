import type webpack from 'webpack'
import {type DevOptions} from '../../extensionDev'

export default function boringPlugins(projectPath: string, {mode}: DevOptions) {
  const project = require(`${projectPath}/manifest.json`)
  const projectName = project.name
  const projectVersion = project.version

  return {
    name: 'boringPlugins',
    apply: (compiler: webpack.Compiler) => {
      compiler.hooks.done.tap('BoringPlugin', (stats) => {
        const divider = stats.hasErrors() ? '✖︎✖︎✖︎' : '►►►'
        stats.compilation.name = `🧩 extension-create ${divider} ${projectName} (v${projectVersion})`
      })
    }
  }
}
