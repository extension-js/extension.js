import fs from 'fs'
import path from 'path'
import webpack from 'webpack'
import colors from '@colors/colors/safe'
import Dotenv from 'dotenv-webpack'
import CleanHotUpdatesPlugin from './CleanHotUpdatesPlugin'

import SpecialFoldersPlugin from './SpecialFoldersPlugin'
import {type DevOptions} from '../../extensionDev'

export default function boringPlugins(projectPath: string, {mode}: DevOptions) {
  const project = require(`${projectPath}/manifest.json`)
  const projectName = project.name
  const projectVersion = project.version

  return {
    constructor: {name: 'BoringPlugin'},
    apply: (compiler: webpack.Compiler) => {
      // Writes the project name and version to the terminal
      compiler.hooks.done.tap('BoringPlugin', (stats) => {
        const divider = stats.hasErrors()
          ? colors.red('✖︎✖︎✖︎')
          : colors.green('►►►')
        stats.compilation.name = `🧩 extension-create ${divider} ${projectName} (v${projectVersion})`
      })

      // Plugin to add special folders (public, pages, scripts) to the extension
      new SpecialFoldersPlugin({
        manifestPath: path.join(projectPath, 'manifest.json')
      }).apply(compiler)

      if (
        fs.existsSync(path.join(projectPath, '.env')) ||
        fs.existsSync(path.join(projectPath, '.env.example')) ||
        fs.existsSync(path.join(projectPath, '.env.defaults'))
      ) {
        // Support .env files
        new Dotenv({
          path: fs.existsSync(path.join(projectPath, '.env'))
            ? path.join(projectPath, '.env')
            : path.join(projectPath, '.env.example'),
          allowEmptyValues: true,
          defaults: fs.existsSync(path.join(projectPath, '.env.defaults')),
          systemvars: true
        } as any).apply(compiler as any)
      }

      // Since we write files to disk, we need to clean up the hot updates
      // to avoid having a lot of files in the output folder.
      // TODO: cezaraugusto this has some issues with content scripts.
      new CleanHotUpdatesPlugin().apply(compiler)
    }
  }
}
