import * as fs from 'fs'
import * as path from 'path'
import {type Compiler} from '@rspack/core'
import {getProjectOutputPath} from '../../commands/commands-lib/get-project-path'

export class CleanDistFolderPlugin {
  constructor(private options: {browser: string}) {}
  apply(compiler: Compiler): void {
    const outputPath = getProjectOutputPath(
      compiler.options.context!,
      this.options.browser
    )

    if (fs.existsSync(outputPath)) {
      try {
        fs.rmSync(outputPath, {recursive: true, force: true})
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
