import type webpack from 'webpack'
import {type DevOptions} from '../../extensionDev'

export default function boringPlugins(projectPath: string, {mode}: DevOptions) {
  const project = require(`${projectPath}/manifest.json`)
  const projectName = project.name
  const projectVersion = project.version

  return {
    name: 'boringPlugins',
    apply: (compiler: webpack.Compiler) => {
      compiler.hooks.done.tap('errorPlugins', (stats) => {
        const divider = stats.hasErrors() ? '✖︎✖︎✖︎' : '►►►'
        stats.compilation.name = `🧩 extension-create ${divider} ${projectName} (${projectVersion}) running in ${mode} mode`
        // stats.compilation.name = `[extension-create 🧩] ${divider} ${projectName} running in ${mode} mode`
      })
    }
  }
}
