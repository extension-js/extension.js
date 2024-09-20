import fs from 'fs'
import path from 'path'
import {type Compiler} from 'webpack'

export class CleanHotUpdatesPlugin {
  apply(compiler: Compiler): void {
    const hotUpdatePath = path.join(compiler.options.output.path || '', 'hot')

    if (fs.existsSync(hotUpdatePath)) {
      try {
        fs.rmSync(hotUpdatePath, {recursive: true, force: true})
        if (process.env.EXTENSION_ENV === 'development') {
          console.log(
            '[CleanHotUpdatesPlugin] Removed old hot-update files before compilation.'
          )
        }
      } catch (error: any) {
        console.error(
          `[CleanHotUpdatesPlugin] Failed to remove hot-update files: ${error.message}`
        )
      }
    }
  }
}
