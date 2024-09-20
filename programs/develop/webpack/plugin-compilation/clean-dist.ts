import fs from 'fs'
import path from 'path'
import {type Compiler} from 'webpack'

export class CleanDistFolderPlugin {
  apply(compiler: Compiler): void {
    const hotUpdatePath = path.join(compiler.options.output.path || '')

    if (fs.existsSync(hotUpdatePath)) {
      try {
        fs.rmSync(hotUpdatePath, {recursive: true, force: true})
        if (process.env.EXTENSION_ENV === 'development') {
          console.log(
            '[CleanDistFolderPlugin] Removed old hot-update files before compilation.'
          )
        }
      } catch (error: any) {
        console.error(
          `[CleanDistFolderPlugin] Failed to remove hot-update files: ${error.message}`
        )
      }
    }
  }
}
