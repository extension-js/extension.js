import fs from 'fs'
import path from 'path'
import type webpack from 'webpack'
import chokidar from 'chokidar'

interface CopyPublicFolderOptions {
  manifestPath: string
}

export class CopyPublicFolder {
  private readonly options: CopyPublicFolderOptions

  constructor(options: CopyPublicFolderOptions) {
    this.options = options
  }

  private ensureDirectoryExistence(filePath: string) {
    const dirname = path.dirname(filePath)
    if (fs.existsSync(dirname)) {
      return true
    }
    fs.mkdirSync(dirname, {recursive: true})
  }

  private copyFile(sourcePath: string, targetPath: string) {
    this.ensureDirectoryExistence(targetPath)
    fs.copyFileSync(sourcePath, targetPath)
  }

  private copyFolder(source: string, target: string) {
    if (!fs.existsSync(target)) fs.mkdirSync(target, {recursive: true})

    const files = fs.readdirSync(source)

    files.forEach((file) => {
      const sourcePath = path.join(source, file)
      const targetPath = path.join(target, file)

      if (fs.statSync(sourcePath).isDirectory()) {
        this.copyFolder(sourcePath, targetPath)
      } else {
        this.copyFile(sourcePath, targetPath)
      }
    })
  }

  apply(compiler: webpack.Compiler): void {
    const projectPath = path.dirname(this.options.manifestPath)
    const staticDir = path.join(projectPath, 'public')
    const output = compiler.options.output?.path || ''

    if (!fs.existsSync(staticDir)) return

    compiler.hooks.afterEmit.tap('special-folders:copy-public-folder', () => {
      const target = path.join(output, '/')

      if (!fs.existsSync(target)) fs.mkdirSync(target, {recursive: true})

      if (fs.existsSync(staticDir)) {
        this.copyFolder(staticDir, target)
      }
    })

    if (compiler.options.mode === 'production') return

    compiler.hooks.afterPlugins.tap(
      'special-folders:copy-public-folder',
      () => {
        const staticPath: string = path.join(projectPath, 'public')
        const watcher = chokidar.watch(staticPath, {ignoreInitial: true})

        watcher.on('add', (filePath: string) => {
          const target = path.join(output, path.relative(projectPath, filePath))
          this.copyFile(filePath, target)
        })

        watcher.on('change', (filePath: string) => {
          const target = path.join(output, path.relative(projectPath, filePath))
          this.copyFile(filePath, target)
        })

        watcher.on('unlink', (filePath: string) => {
          const target = path.join(output, path.relative(projectPath, filePath))

          if (fs.existsSync(target)) {
            fs.unlinkSync(target)
          }
        })

        compiler.hooks.watchClose.tap(
          'special-folders:copy-public-folder',
          () => {
            watcher.close().catch(console.error)
          }
        )
      }
    )
  }
}
