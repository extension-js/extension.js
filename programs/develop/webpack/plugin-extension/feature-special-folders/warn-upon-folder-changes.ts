import * as path from 'path'
import * as chokidar from 'chokidar'
import {type Compiler} from 'webpack'
import * as messages from '../../lib/messages'

export class WarnUponFolderChanges {
  private readonly manifestPath: string

  constructor(manifestPath: string) {
    this.manifestPath = manifestPath
  }

  private throwCompilationError(
    folder: string,
    filePath: string,
    isAddition?: boolean
  ) {
    const pathRelative = path.relative(process.cwd(), filePath)
    const addingOrRemoving = isAddition ? 'Adding' : 'Removing'
    const addedOrRemoved = isAddition ? 'added' : 'removed'
    const typeOfAsset = folder === 'pages' ? 'HTML pages' : 'script files'
    const errorMessage = messages.serverRestartRequiredFromSpecialFolder(
      addingOrRemoving,
      addedOrRemoved,
      folder,
      typeOfAsset,
      pathRelative
    )
    // Adding a page or script doesn't make it loaded but at least don't break anything,
    // so we add a warning instead of an error and user can keep working.
    if (isAddition) {
      console.warn(errorMessage)
      return
    }

    // Removing a page or script breaks the program, so we add an error and
    // user need to restart to see changes.
    console.error(errorMessage)
    process.exit(1)
  }

  public apply(compiler: Compiler): void {
    compiler.hooks.afterPlugins.tap(
      'special-folders:warn-upon-folder-changes',
      () => {
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
            this.throwCompilationError('pages', filePath, true)
          }
        })

        pagesWatcher.on('unlink', (filePath: string) => {
          const isHtml = filePath.endsWith('.html')
          if (isHtml) {
            this.throwCompilationError('pages', filePath)
          }
        })

        scriptsWatcher.on('add', (filePath: string) => {
          const isScript = extensionsSupported?.includes(path.extname(filePath))
          if (isScript) {
            this.throwCompilationError('scripts', filePath, true)
          }
        })

        scriptsWatcher.on('unlink', (filePath: string) => {
          const isScript = extensionsSupported?.includes(path.extname(filePath))
          if (isScript) {
            this.throwCompilationError('scripts', filePath)
          }
        })

        compiler.hooks.watchClose.tap('WarnUponFolderChanges', () => {
          pagesWatcher.close().catch(console.error)
          scriptsWatcher.close().catch(console.error)
        })
      }
    )
  }
}
