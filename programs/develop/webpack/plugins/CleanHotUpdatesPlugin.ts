import * as fs from 'fs'
import * as path from 'path'
import {Compilation, type Compiler} from 'webpack'

export default class CleanHotUpdatesPlugin {
  apply(compiler: Compiler): void {
    compiler.hooks.thisCompilation.tap(
      'CleanHotUpdatesPlugin',
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'CleanHotUpdatesPlugin',
            stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONS
          },
          () => {
            const hotUpdatePath = path.join(
              compilation.options.output.path || '',
              'hot'
            )

            // Check if the hot/ directory exists and delete it
            if (fs.existsSync(hotUpdatePath)) {
              fs.rmSync(hotUpdatePath, {recursive: true, force: true})
              if (process.env.EXTENSION_ENV === 'development') {
                console.log(
                  '[CleanHotUpdatesPlugin] Removed old hot-update files.'
                )
              }
            }
          }
        )
      }
    )
  }
}
