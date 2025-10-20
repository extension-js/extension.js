import * as fs from 'fs'
import * as path from 'path'
import {type Compiler} from '@rspack/core'

export class CleanDistFolderPlugin {
  constructor(private options: {browser: string}) {}
  apply(compiler: Compiler): void {
    const logger = compiler.getInfrastructureLogger('plugin-compilation:clean')
    const distPath = path.join(
      compiler.options.context!,
      'dist',
      this.options.browser
    )

    if (fs.existsSync(distPath)) {
      try {
        fs.rmSync(distPath, {recursive: true, force: true})
        if (process.env.EXTENSION_ENV === 'development') {
          logger.info(
            '[CleanDistFolderPlugin] Removed old hot-update files before compilation.'
          )
        }
      } catch (error: any) {
        logger.error(
          `[CleanDistFolderPlugin] Failed to remove hot-update files: ${error.message}`
        )
      }
    }
  }
}
