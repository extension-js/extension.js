import fs from 'fs'
import path from 'path'
import type webpack from 'webpack'

interface CopyStaticFolderOptions {
  staticDir: string
}

export default class CopyStaticFolder {
  private readonly options: CopyStaticFolderOptions

  constructor(options: CopyStaticFolderOptions) {
    this.options = options
  }

  private copyFolder(source: string, target: string) {
    if (!fs.existsSync(target)) fs.mkdirSync(target)

    const files = fs.readdirSync(source)

    files.forEach((file) => {
      const sourcePath = path.join(source, file)
      const targetPath = path.join(target, file)

      if (fs.statSync(sourcePath).isDirectory()) {
        this.copyFolder(sourcePath, targetPath)
      } else {
        fs.copyFileSync(sourcePath, targetPath)
      }
    })
  }

  apply(compiler: webpack.Compiler): void {
    const {staticDir} = this.options
    const output = compiler.options.output?.path || ''

    compiler.hooks.afterEmit.tap('ResourcesPlugin (CopyStaticFolder)', () => {
      if (!staticDir) return

      const source = staticDir
      const target = path.join(output, path.basename(staticDir))

      // Too early
      if (!fs.existsSync(output)) return

      // No user option.
      if (!fs.existsSync(source)) return

      // Target doesn't exist but we can create one.
      if (!fs.existsSync(target)) fs.mkdirSync(target)

      const files = fs.readdirSync(source)

      files.forEach((file) => {
        const sourcePath = path.join(source, file)
        const targetPath = path.join(target, file)

        if (fs.statSync(sourcePath).isDirectory()) {
          this.copyFolder(sourcePath, targetPath)
        } else {
          fs.copyFileSync(sourcePath, targetPath)
        }
      })
    })
  }
}
