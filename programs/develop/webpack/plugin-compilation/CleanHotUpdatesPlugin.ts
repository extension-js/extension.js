import fs from 'fs'
import path from 'path'
import {type Compiler} from 'webpack'

export default class CleanHotUpdatesPlugin {
  apply(compiler: Compiler): void {
    const hotUpdatePath = path.join(compiler.options.output.path || '', 'hot')

    if (fs.existsSync(hotUpdatePath)) {
      fs.rmSync(hotUpdatePath, {recursive: true, force: true})
      if (process.env.EXTENSION_ENV === 'development') {
        console.log(
          '[CleanHotUpdatesPlugin] Removed old hot-update files before compilation.'
        )
      }
    }
  }
}
