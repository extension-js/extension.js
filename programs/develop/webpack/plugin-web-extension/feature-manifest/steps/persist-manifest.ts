// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import * as fs from 'fs'
import * as path from 'path'
import rspack, {Compilation, Compiler} from '@rspack/core'

function writeFileAtomically(targetPath: string, content: string) {
  const directory = path.dirname(targetPath)
  const tempPath = path.join(
    directory,
    `.manifest.${process.pid}.${Date.now()}.${Math.random()
      .toString(16)
      .slice(2)}.tmp`
  )

  fs.mkdirSync(directory, {recursive: true})
  fs.writeFileSync(tempPath, content, 'utf-8')
  fs.renameSync(tempPath, targetPath)
}

export class PersistManifestToDisk {
  apply(compiler: Compiler) {
    compiler.hooks.thisCompilation.tap(
      'manifest:persist-manifest',
      (compilation: Compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'manifest:persist-manifest',
            stage: Compilation.PROCESS_ASSETS_STAGE_REPORT + 1000
          },
          () => {
            if (compilation.errors.length > 0) return

            const manifestAsset = compilation.getAsset('manifest.json')
            const outputPath =
              compilation.outputOptions.path || compiler.options.output?.path

            if (!manifestAsset || !outputPath) return

            const manifestSource = manifestAsset.source.source().toString()
            const manifestOutputPath = path.join(outputPath, 'manifest.json')

            try {
              writeFileAtomically(manifestOutputPath, manifestSource)
            } catch (error: any) {
              const err = new rspack.WebpackError(
                `Failed to persist manifest.json to disk: ${error.message}`
              ) as Error & {file?: string}
              err.file = 'manifest.json'
              compilation.errors.push(err)
            }
          }
        )
      }
    )
  }
}
