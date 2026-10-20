// ███████╗██████╗ ███████╗ ██████╗██╗ █████╗ ██╗      ███████╗ ██████╗ ██╗     ██████╗ ███████╗██████╗ ███████╗
// ██╔════╝██╔══██╗██╔════╝██╔════╝██║██╔══██╗██║      ██╔════╝██╔═══██╗██║     ██╔══██╗██╔════╝██╔══██╗██╔════╝
// ███████╗██████╔╝█████╗  ██║     ██║███████║██║█████╗█████╗  ██║   ██║██║     ██║  ██║█████╗  ██████╔╝███████╗
// ╚════██║██╔═══╝ ██╔══╝  ██║     ██║██╔══██║██║╚════╝██╔══╝  ██║   ██║██║     ██║  ██║██╔══╝  ██╔══██╗╚════██║
// ███████║██║     ███████╗╚██████╗██║██║  ██║███████╗ ██║     ╚██████╔╝███████╗██████╔╝███████╗██║  ██║███████║
// ╚══════╝╚═╝     ╚══════╝ ╚═════╝╚═╝╚═╝  ╚═╝╚══════╝ ╚═╝      ╚═════╝ ╚══════╝╚═════╝ ╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {type Compilation, type Compiler, WebpackError} from '@rspack/core'
import {requestDevSessionRestart} from '../dev-server/session-restart'
import {debugLine, isDebug} from '../lib/messaging'
import {
  foldersRoots,
  isScriptsFolderEntry,
  type SpecialFolderName,
  type SpecialFoldersRoots
} from './folders-config'
import * as messages from './messages'

type SpecialFolder = SpecialFolderName
type ChangeType = 'add' | 'remove'
type PendingChange = {
  type: ChangeType
  folder: SpecialFolder
  filePath: string
}

export class WarnUponFolderChanges {
  private pendingChanges: PendingChange[] = []
  // Snapshot of files present in pages/ and scripts/ at first compile, used to
  // distinguish "newly added" from "modified" on subsequent invalidations.
  private knownFolderFiles = new Set<string>()
  private hasSnapshot = false

  private snapshotFolderFiles(roots: SpecialFoldersRoots) {
    if (this.hasSnapshot) return

    this.hasSnapshot = true
    const SKIP_DIRS = new Set([
      'node_modules',
      'dist',
      'build',
      '.git',
      '.turbo',
      '.next',
      'coverage'
    ])

    const walk = (dir: string) => {
      let entries: fs.Dirent[]

      try {
        entries = fs.readdirSync(dir, {withFileTypes: true})
      } catch {
        return
      }

      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue
        if (SKIP_DIRS.has(entry.name)) continue

        const full = path.join(dir, entry.name)
        if (entry.isFile()) this.knownFolderFiles.add(full)
        else if (entry.isDirectory()) walk(full)
      }
    }

    for (const folderPath of Object.values(roots)) {
      if (fs.existsSync(folderPath)) walk(folderPath)
    }
  }

  // A folder that exists is watched whole. One that does not is watched by
  // its own path as a missing dependency, so creating it later still
  // recompiles without the whole project root under watch: a screenshot or a
  // demo page written anywhere in the project is not a reason to rebuild.
  private getWatchedFolders(projectPath: string): {
    present: string[]
    missing: string[]
  } {
    const present = new Set<string>()
    const missing = new Set<string>()

    for (const folderPath of Object.values(foldersRoots(projectPath))) {
      if (fs.existsSync(folderPath)) present.add(folderPath)
      else missing.add(folderPath)
    }

    return {present: Array.from(present), missing: Array.from(missing)}
  }

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
      // A live session picks the new entry up by restarting itself; only a
      // removal, which breaks the current build, keeps refusing below.
      if (
        requestDevSessionRestart(compilation.compiler, {
          reason: folder === 'pages' ? 'html' : 'scripts',
          pathAfter: filePath
        })
      ) {
        return
      }

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
    if (isDebug()) {
      debugLine(
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
    const roots = foldersRoots(projectPath)
    this.snapshotFolderFiles(roots)
    const isUnder = (root: string | undefined, filePath: string) =>
      Boolean(root) && filePath.startsWith(root + path.sep)
    const isPage = (filePath: string) =>
      isUnder(roots.pages, filePath) && filePath.endsWith('.html')
    const isScript = (filePath: string) =>
      isUnder(roots.scripts, filePath) && isScriptsFolderEntry(filePath)

    const modifiedFiles = compiler.modifiedFiles || new Set<string>()
    const removedFiles = compiler.removedFiles || new Set<string>()

    for (const filePath of modifiedFiles) {
      // Modifications of an existing file are NOT additions: rspack recompiles
      // them in place. "Restart required" only applies to brand-new files.
      const isPreexisting = this.knownFolderFiles.has(filePath)

      if (isPage(filePath)) {
        if (isPreexisting) continue

        this.knownFolderFiles.add(filePath)
        this.trackChange(projectPath, 'pages', 'add', filePath)
        continue
      }

      if (isScript(filePath)) {
        if (isPreexisting) continue

        this.knownFolderFiles.add(filePath)
        this.trackChange(projectPath, 'scripts', 'add', filePath)
      }
    }

    for (const filePath of removedFiles) {
      // Drop from the snapshot so a future re-add of the same name is
      // detected as a genuine addition rather than a modification.
      this.knownFolderFiles.delete(filePath)

      if (isPage(filePath)) {
        this.trackChange(projectPath, 'pages', 'remove', filePath)
      }

      if (isScript(filePath)) {
        this.trackChange(projectPath, 'scripts', 'remove', filePath)
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

        const folders = this.getWatchedFolders(projectPath)

        for (const folderPath of folders.present) {
          compilation.contextDependencies?.add(folderPath)
        }

        for (const folderPath of folders.missing) {
          compilation.missingDependencies?.add(folderPath)
        }

        this.applyPendingChanges(compilation)
      }
    )
  }
}
