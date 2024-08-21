import fs from 'fs'
import path from 'path'
import {type Compiler} from 'webpack'
import Dotenv from 'dotenv-webpack'
import * as messages from '../lib/messages'
import {type Manifest} from '../webpack-types'

export class EnvPlugin {
  public readonly manifestPath: string

  constructor(options: {manifestPath: string}) {
    this.manifestPath = options.manifestPath
  }

  apply(compiler: Compiler) {
    const projectPath = path.dirname(this.manifestPath)
    const manifest: Manifest = require(this.manifestPath)
    const manifestName = manifest.name || 'Extension.js'

    // Support .env files
    if (
      fs.existsSync(path.join(projectPath, '.env')) ||
      fs.existsSync(path.join(projectPath, '.env.example')) ||
      fs.existsSync(path.join(projectPath, '.env.local')) ||
      fs.existsSync(path.join(projectPath, '.env.defaults'))
    ) {
      console.log(messages.envFileLoaded(manifestName))

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
