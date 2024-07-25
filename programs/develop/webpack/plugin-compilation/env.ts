import fs from 'fs'
import path from 'path'
import colors, {bold, blue, yellow} from '@colors/colors/safe'
import Dotenv from 'dotenv-webpack'
import {type Compiler} from 'webpack'
import {type Manifest} from '../types'

export class EnvPlugin {
  public readonly manifestPath: string

  constructor(options: {manifestPath: string}) {
    this.manifestPath = options.manifestPath
  }

  apply(compiler: Compiler) {
    const manifest: Manifest = require(this.manifestPath)
    const manifestName = manifest.name
    const manifestVersion = manifest.version

    // Writes the project name and version to the terminal
    compiler.hooks.done.tap('BoringPlugin', (stats) => {
      const divider = stats.hasErrors()
        ? colors.red('✖︎✖︎✖︎')
        : colors.green('►►►')

      stats.compilation.name = `🧩 Extension.js ${divider} ${manifestName} (v${manifestVersion})`
    })

    const projectPath = path.dirname(this.manifestPath)
    // Support .env files
    if (
      fs.existsSync(path.join(projectPath, '.env')) ||
      fs.existsSync(path.join(projectPath, '.env.example')) ||
      fs.existsSync(path.join(projectPath, '.env.local')) ||
      fs.existsSync(path.join(projectPath, '.env.defaults'))
    ) {
      console.log(
        `🧩 Extension.js ${blue(
          '►►►'
        )} ${manifestName} (v${manifestVersion}) ` +
          `${yellow('env')} file loaded.`
      )

      new Dotenv({
        path: fs.existsSync(path.join(projectPath, '.env'))
          ? path.join(projectPath, '.env')
          : fs.existsSync(path.join(projectPath, '.env.local'))
            ? path.join(projectPath, '.env.local')
            : path.join(projectPath, '.env.example'),
        allowEmptyValues: true,
        defaults: fs.existsSync(path.join(projectPath, '.env.defaults')),
        systemvars: true
        // @ts-expect-error - Seems plugin is not up to date
      }).apply(compiler)
    }
  }
}
