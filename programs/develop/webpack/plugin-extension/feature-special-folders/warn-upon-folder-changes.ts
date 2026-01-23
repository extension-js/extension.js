// ███████╗██████╗ ███████╗ ██████╗██╗ █████╗ ██╗      ███████╗ ██████╗ ██╗     ██████╗ ███████╗██████╗ ███████╗
// ██╔════╝██╔══██╗██╔════╝██╔════╝██║██╔══██╗██║      ██╔════╝██╔═══██╗██║     ██╔══██╗██╔════╝██╔══██╗██╔════╝
// ███████╗██████╔╝█████╗  ██║     ██║███████║██║█████╗█████╗  ██║   ██║██║     ██║  ██║█████╗  ██████╔╝███████╗
// ╚════██║██╔═══╝ ██╔══╝  ██║     ██║██╔══██║██║╚════╝██╔══╝  ██║   ██║██║     ██║  ██║██╔══╝  ██╔══██╗╚════██║
// ███████║██║     ███████╗╚██████╗██║██║  ██║███████╗ ██║     ╚██████╔╝███████╗██████╔╝███████╗██║  ██║███████║
// ╚══════╝╚═╝     ╚══════╝ ╚═════╝╚═╝╚═╝  ╚═╝╚══════╝ ╚═╝      ╚═════╝ ╚══════╝╚═════╝ ╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import * as path from 'path'
import {type Compiler, type Compilation, WebpackError} from '@rspack/core'
import * as messages from './messages'

type SpecialFolder = 'pages' | 'scripts'
type ChangeType = 'add' | 'remove'
type PendingChange = {
  type: ChangeType
  folder: SpecialFolder
  filePath: string
}

export class WarnUponFolderChanges {
  private pendingChanges: PendingChange[] = []

  private throwCompilationError(
    compilation: Compilation,
    folder: SpecialFolder,
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

  private trackChange(
    projectPath: string,
    folder: SpecialFolder,
    change: ChangeType,
    filePath: string
  ) {
    if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
      console.log(
        messages.specialFolderChangeDetected(
          change === 'add' ? 'add' : 'remove',
          folder,
          path.relative(projectPath, filePath)
        )
      )
    }

    this.pendingChanges.push({type: change, folder, filePath})
  }

  private collectChanges(compiler: Compiler) {
    const projectPath: string =
      (compiler.options.context as string) || process.cwd()
    const pagesPath = path.join(projectPath, 'pages') + path.sep
    const scriptsPath = path.join(projectPath, 'scripts') + path.sep
    const extensionsSupported = compiler.options.resolve?.extensions as
      | string[]
      | undefined
    const supportedScripts = new Set(
      (extensionsSupported || []).map((e) => e.toLowerCase())
    )

    const modifiedFiles = compiler.modifiedFiles || new Set<string>()
    const removedFiles = compiler.removedFiles || new Set<string>()

    for (const filePath of modifiedFiles) {
      if (filePath.startsWith(pagesPath) && filePath.endsWith('.html')) {
        this.trackChange(projectPath, 'pages', 'add', filePath)
      }

      if (filePath.startsWith(scriptsPath)) {
        const ext = path.extname(filePath).toLowerCase()

        if (supportedScripts.has(ext)) {
          this.trackChange(projectPath, 'scripts', 'add', filePath)
        }
      }
    }

    for (const filePath of removedFiles) {
      if (filePath.startsWith(pagesPath) && filePath.endsWith('.html')) {
        this.trackChange(projectPath, 'pages', 'remove', filePath)
      }

      if (filePath.startsWith(scriptsPath)) {
        const ext = path.extname(filePath).toLowerCase()

        if (supportedScripts.has(ext)) {
          this.trackChange(projectPath, 'scripts', 'remove', filePath)
        }
      }
    }
  }

  private applyPendingChanges(compilation: Compilation) {
    for (const change of this.pendingChanges) {
      this.throwCompilationError(
        compilation,
        change.folder,
        change.filePath,
        change.type === 'add'
      )
    }

    this.pendingChanges = []
  }

  public apply(compiler: Compiler): void {
    compiler.hooks.watchRun.tap(
      'special-folders:warn-upon-folder-changes',
      () => {
        this.collectChanges(compiler)
      }
    )

    compiler.hooks.thisCompilation.tap(
      'special-folders:warn-upon-folder-changes',
      (compilation) => {
        const projectPath: string =
          (compiler.options.context as string) || process.cwd()
        const pagesPath: string = path.join(projectPath, 'pages')
        const scriptsPath: string = path.join(projectPath, 'scripts')

        compilation.contextDependencies?.add(pagesPath)
        compilation.contextDependencies?.add(scriptsPath)

        this.applyPendingChanges(compilation)
      }
    )
  }
}
