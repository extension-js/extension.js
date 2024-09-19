import fs from 'fs'
import path from 'path'
import {type Compiler} from 'webpack'

export class CleanHotUpdatesPlugin {
  apply(compiler: Compiler): void {
    const hotUpdatePath = path.join(compiler.options.output.path || '', 'hot')

    if (fs.existsSync(hotUpdatePath)) {
      fs.rmdirSync(hotUpdatePath, {recursive: true})
      if (process.env.EXTENSION_ENV === 'development') {
        console.log(
          '[CleanHotUpdatesPlugin] Removed old hot-update files before compilation.'
        )
      }
    }
  }
}
