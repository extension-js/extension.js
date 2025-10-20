import * as path from 'path'
import * as chokidar from 'chokidar'
import {type Compiler, type Compilation, WebpackError} from '@rspack/core'
import * as messages from '../../webpack-lib/messages'

export class WarnUponFolderChanges {
  private readonly manifestPath: string

  constructor(manifestPath: string) {
    this.manifestPath = manifestPath
  }

  private throwCompilationError(
    compilation: Compilation,
    folder: string,
    filePath: string,
    isAddition?: boolean
  ) {
    const addingOrRemoving = isAddition ? 'Adding' : 'Removing'
    const typeOfAsset = folder === 'pages' ? 'HTML pages' : 'script files'
    const errorMessage =
      messages.serverRestartRequiredFromSpecialFolderMessageOnly(
        addingOrRemoving,
        folder,
        typeOfAsset
      )

    // Adding a page or script doesn't make it loaded but at least don't break anything,
    // so we add a warning instead of an error and user can keep working.
    if (isAddition) {
      const warn = new WebpackError(errorMessage) as Error & {
        name?: string
        file?: string
        details?: string
      }
      warn.name = 'SpecialFoldersChange'
      warn.file = filePath
      warn.details = `Detected change in ${folder}/ affecting ${typeOfAsset}. Restart may be required for full effect.`
      compilation.warnings?.push(warn)
      return
    }

    // Removing a page or script breaks the program, so we add an error and
    // user need to restart to see changes.
    const err = new WebpackError(errorMessage) as Error & {
      name?: string
      file?: string
      details?: string
    }
    err.name = 'SpecialFoldersRemoval'
    err.file = filePath
    err.details = `Removing from ${folder}/ breaks current build. Restart the dev server to recompile.`
    compilation.errors?.push(err)
  }

  public apply(compiler: Compiler): void {
    compiler.hooks.thisCompilation.tap(
      'special-folders:warn-upon-folder-changes',
      (compilation) => {
        const projectPath: string = path.dirname(this.manifestPath)
        const pagesPath: string = path.join(projectPath, 'pages')
        const scriptsPath: string = path.join(projectPath, 'scripts')

        const pagesWatcher = chokidar.watch(pagesPath, {ignoreInitial: true})
        const scriptsWatcher = chokidar.watch(scriptsPath, {
          ignoreInitial: true
        })
        const extensionsSupported = compiler.options.resolve?.extensions

        pagesWatcher.on('add', (filePath: string) => {
          const isHtml = filePath.endsWith('.html')
          if (isHtml) {
            this.throwCompilationError(compilation, 'pages', filePath, true)
          }
        })

        pagesWatcher.on('unlink', (filePath: string) => {
          const isHtml = filePath.endsWith('.html')
          if (isHtml) {
            this.throwCompilationError(compilation, 'pages', filePath)
          }
        })

        scriptsWatcher.on('add', (filePath: string) => {
          const isScript = extensionsSupported?.includes(path.extname(filePath))
          if (isScript) {
            this.throwCompilationError(compilation, 'scripts', filePath, true)
          }
        })

        scriptsWatcher.on('unlink', (filePath: string) => {
          const isScript = extensionsSupported?.includes(path.extname(filePath))
          if (isScript) {
            this.throwCompilationError(compilation, 'scripts', filePath)
          }
        })

        compiler.hooks.watchClose.tap('WarnUponFolderChanges', () => {
          pagesWatcher.close().catch(() => {})
          scriptsWatcher.close().catch(() => {})
        })
      }
    )
  }
}
