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
        if (fs.rmSync) {
          fs.rmSync(distPath, {recursive: true, force: true})
        } else {
          // Node <14 fallback
          fs.rmdirSync(distPath, {recursive: true})
        }
        if (process.env.EXTENSION_ENV === 'development') {
          logger.info(
            '[CleanDistFolderPlugin] Removed old hot-update files before compilation.'
          )
        }
      } catch (error: any) {
        // Retry once on Windows when files are temporarily locked
        if (
          process.platform === 'win32' &&
          /EBUSY|EPERM/i.test(String(error?.code || error?.message))
        ) {
          setTimeout(() => {
            try {
              if (fs.rmSync) {
                fs.rmSync(distPath, {recursive: true, force: true})
              } else {
                fs.rmdirSync(distPath, {recursive: true} as any)
              }
            } catch {
              // Ignore
            }
          }, 100)
        }

        logger.error(
          `[CleanDistFolderPlugin] Failed to remove hot-update files: ${error.message}`
        )
      }
    }
  }
}
