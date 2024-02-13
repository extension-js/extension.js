import fs from 'fs'
import path from 'path'
import type webpack from 'webpack'
import chokidar from 'chokidar'

interface CopyStaticFolderOptions {
  manifestPath: string
}

export default class CopyStaticFolder {
  private readonly options: CopyStaticFolderOptions

  constructor(options: CopyStaticFolderOptions) {
    this.options = options
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
        fs.copyFileSync(sourcePath, targetPath)
      }
    })
  }

  apply(compiler: webpack.Compiler): void {
    const projectPath = path.dirname(this.options.manifestPath)
    const staticDir = path.join(projectPath, 'public')
    const output = compiler.options.output?.path || ''

    if (!fs.existsSync(staticDir)) return

    compiler.hooks.afterPlugins.tap('WatchPagesPlugin', () => {
      const projectPath: string = path.dirname(this.options.manifestPath)
      const pagesPath: string = path.join(projectPath, 'public')

      const watcher = chokidar.watch(pagesPath, {
        ignoreInitial: true
      })

      watcher.on('add', (filePath: string) => {
        console.log('>>>>>>>>>>> File copied:', filePath)
        const target = path.join(output, path.relative(staticDir, filePath))
        fs.copyFileSync(filePath, target)
      })

      watcher.on('unlink', (filePath: string) => {
        console.log('>>>>>>>>>>> File deleted:', filePath)
        const target = path.join(output, path.relative(staticDir, filePath))

        if (fs.existsSync(target)) {
          fs.unlinkSync(target)
        }
      })

      compiler.hooks.watchClose.tap('WatchPagesPlugin', () => {
        watcher.close()
      })
    })

    compiler.hooks.afterEmit.tap('CopyStaticFolder', () => {
      const target = path.join(output, 'public')

      if (!fs.existsSync(target)) fs.mkdirSync(target, {recursive: true})

      if (fs.existsSync(staticDir)) {
        this.copyFolder(staticDir, target)
      }
    })
  }
}
