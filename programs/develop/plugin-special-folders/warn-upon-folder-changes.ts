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
import {debugLine, isDebug} from '../lib/messaging'
import {isInsidePath} from '../lib/real-path'
import {requestSessionRestart} from '../lib/session-restart-signal'
import {
  foldersRoots,
  type SpecialFolderName,
  type SpecialFoldersRoots
} from '../lib/special-folders/folders-config'
import {isEntryFolderFile, walkEntryFolder} from './entry-folders'
import * as messages from './messages'
import {linkedEntryFiles} from './walked-entries'

type SpecialFolder = SpecialFolderName
type ChangeType = 'add' | 'remove'
type PendingChange = {
  type: ChangeType
  folder: SpecialFolder
  filePath: string
}

// The same walk the scan makes, so a file the watcher calls new is one the
// scan would enroll, and the other way around. Links inside the project too.
function readSpecialFolderFiles(
  roots: SpecialFoldersRoots,
  projectPath: string
): Set<string> {
  const found = new Set<string>()

  for (const folderPath of Object.values(roots)) {
    for (const file of walkEntryFolder(folderPath, () => true)) found.add(file)
  }

  for (const file of linkedEntryFiles(projectPath)) found.add(file)

  return found
}

export interface WarnUponFolderChangesOptions {
  // The files under the folders right now. The disk walk by default.
  readFolderFiles?: (
    roots: SpecialFoldersRoots,
    projectPath: string
  ) => Set<string>
  // Asks the live session to restart. False means no session can.
  requestRestart?: typeof requestSessionRestart
}

export class WarnUponFolderChanges {
  private readonly readFolderFiles: (
    roots: SpecialFoldersRoots,
    projectPath: string
  ) => Set<string>
  private readonly requestRestart: typeof requestSessionRestart

  constructor({
    readFolderFiles = readSpecialFolderFiles,
    requestRestart = requestSessionRestart
  }: WarnUponFolderChangesOptions = {}) {
    this.readFolderFiles = readFolderFiles
    this.requestRestart = requestRestart
  }

  private pendingChanges: PendingChange[] = []
  // Snapshot of files present in pages/ and scripts/ at first compile, used to
  // distinguish "newly added" from "modified" on subsequent invalidations.
  private knownFolderFiles = new Set<string>()
  private hasSnapshot = false

  // Files whose removal a restart already answers. What this build says
  // about them being missing is noise the next compiler does not repeat.
  private goneFiles: Array<{folder: SpecialFolder; filePath: string}> = []
  private removedInPass: string[] = []

  // A save during a compile starts the next one and the first never reaches
  // done, so what it saw still waits for the compile that does.
  private compileEnded = true

  // The files the folders held the last time they were read from disk.
  private filesOnDisk = new Set<string>()

  private snapshotFolderFiles(roots: SpecialFoldersRoots, projectPath: string) {
    if (this.hasSnapshot) return

    this.hasSnapshot = true
    this.filesOnDisk = this.readFolderFiles(roots, projectPath)

    for (const file of this.filesOnDisk) this.knownFolderFiles.add(file)
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

  // True when a live session restarts for the change, which answers it.
  private throwCompilationError(
    compilation: Compilation,
    folder: SpecialFolder,
    filePath: string,
    isAddition?: boolean
  ): boolean {
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
      // A live session picks the new entry up by restarting itself.
      if (
        this.requestRestart(compilation.compiler, {
          reason: folder === 'pages' ? 'html' : 'scripts',
          pathAfter: filePath
        })
      ) {
        return true
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

      return false
    }

    // A live session drops the entry by restarting itself, which also clears
    // its outputs. With no session to restart, the removal stays an error.
    if (
      this.requestRestart(compilation.compiler, {
        reason: folder === 'pages' ? 'html' : 'scripts',
        pathBefore: filePath
      })
    ) {
      this.goneFiles.push({folder, filePath})

      return true
    }

    const err = new WebpackError(errorMessage) as Error & {
      name?: string
      file?: string
      details?: string
    }
    err.name = 'SpecialFoldersRemoval'
    err.file = filePath
    err.details = `Removing from ${folder}/ breaks current build. Restart the dev server to recompile.`
    compilation.errors?.push(err)

    return false
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
    const firstRead = !this.hasSnapshot
    this.snapshotFolderFiles(roots, projectPath)
    const isUnder = (root: string | undefined, filePath: string) =>
      Boolean(root) && isInsidePath(root as string, filePath)
    const isPage = (filePath: string) =>
      isUnder(roots.pages, filePath) && isEntryFolderFile('pages', filePath)
    const isScript = (filePath: string) =>
      isUnder(roots.scripts, filePath) && isEntryFolderFile('scripts', filePath)

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
      if (!this.removedInPass.includes(filePath)) {
        this.removedInPass.push(filePath)
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

    if (!firstRead) this.collectChangesOnDisk(projectPath, roots)
  }

  // The watcher reports a folder for a file that is new in it, and names no
  // file the build never read. Reading the folders again finds both.
  private collectChangesOnDisk(
    projectPath: string,
    roots: SpecialFoldersRoots
  ) {
    const before = this.filesOnDisk
    const now = this.readFolderFiles(roots, projectPath)

    const folderOf = (filePath: string): SpecialFolder | undefined => {
      if (roots.pages && isInsidePath(roots.pages, filePath)) {
        return isEntryFolderFile('pages', filePath) ? 'pages' : undefined
      }

      if (roots.scripts && isInsidePath(roots.scripts, filePath)) {
        return isEntryFolderFile('scripts', filePath) ? 'scripts' : undefined
      }

      return undefined
    }

    const tracked = (type: ChangeType, filePath: string) =>
      this.pendingChanges.some(
        (change) => change.type === type && change.filePath === filePath
      )

    this.filesOnDisk = now

    for (const filePath of now) {
      if (before.has(filePath)) continue

      const folder = folderOf(filePath)

      this.knownFolderFiles.add(filePath)

      if (folder && !tracked('add', filePath)) {
        this.trackChange(projectPath, folder, 'add', filePath)
      }
    }

    for (const filePath of before) {
      if (now.has(filePath)) continue

      const folder = folderOf(filePath)

      this.knownFolderFiles.delete(filePath)

      if (folder && !tracked('remove', filePath)) {
        this.trackChange(projectPath, folder, 'remove', filePath)
      }
    }
  }

  private applyPendingChanges(compilation: Compilation) {
    // A rename arrives as one removal and one addition in the same folder,
    // and the session names both in the one restart it asks for.
    for (const folder of ['pages', 'scripts'] as const) {
      const inFolder = this.pendingChanges.filter(
        (change) => change.folder === folder
      )
      const added = inFolder.filter((change) => change.type === 'add')
      const removed = inFolder.filter((change) => change.type === 'remove')

      if (added.length !== 1 || removed.length !== 1) continue

      const renamed = this.requestRestart(compilation.compiler, {
        reason: folder === 'pages' ? 'html' : 'scripts',
        pathBefore: removed[0].filePath,
        pathAfter: added[0].filePath
      })

      if (renamed) {
        this.goneFiles.push({folder, filePath: removed[0].filePath})
        this.pendingChanges = this.pendingChanges.filter(
          (change) => change.folder !== folder
        )
      }
    }

    // A diagnostic stays pending until a compile ends, a superseded one
    // never reports it. A restart already answered its change.
    this.pendingChanges = this.pendingChanges.filter(
      (change) =>
        !this.throwCompilationError(
          compilation,
          change.folder,
          change.filePath,
          change.type === 'add'
        )
    )
  }

  private dropNoiseAboutGoneFiles(
    compiler: Compiler,
    compilation: Compilation
  ) {
    const goneFiles = this.goneFiles
    const removedInPass = this.removedInPass

    this.goneFiles = []
    this.removedInPass = []
    if (goneFiles.length === 0) return

    const roots = foldersRoots(
      (compiler.options.context as string) || process.cwd()
    )
    const toPosix = (file: string) => file.replace(/\\/g, '/')
    // A file that left with the entry, a page's own script for one, and the
    // manifest field the entry was listed under.
    const needles = [
      ...removedInPass,
      ...goneFiles.map((gone) => gone.filePath)
    ].flatMap((file) => [file, toPosix(file)])

    for (const {folder, filePath} of goneFiles) {
      const root = roots[folder]

      if (!root) continue

      const name = toPosix(path.relative(root, filePath)).replace(
        /\.[^./]+$/,
        ''
      )

      needles.push(`${folder}.${name} field`, `${folder}/${name} field`)
    }

    const isNoise = (issue: unknown) => {
      const {message, details} = (issue || {}) as {
        message?: unknown
        details?: unknown
      }
      const text = `${String(message ?? issue)}\n${String(details ?? '')}`

      return needles.some((needle) => text.includes(needle))
    }

    compilation.errors = compilation.errors.filter((issue) => !isNoise(issue))
    compilation.warnings = compilation.warnings.filter(
      (issue) => !isNoise(issue)
    )
  }

  public apply(compiler: Compiler): void {
    // Ahead of every reporter, so none of them prints or records the noise.
    compiler.hooks.done.tap(
      {name: 'special-folders:warn-upon-folder-changes', stage: -1000},
      (stats) => {
        if (compiler.watchMode) {
          this.dropNoiseAboutGoneFiles(compiler, stats.compilation)
        }

        this.compileEnded = true
      }
    )

    compiler.hooks.watchRun.tap(
      'special-folders:warn-upon-folder-changes',
      () => {
        if (this.compileEnded) {
          this.pendingChanges = []
          this.removedInPass = []
        }

        this.compileEnded = false
        this.collectChanges(compiler)
      }
    )

    compiler.hooks.thisCompilation.tap(
      'special-folders:warn-upon-folder-changes',
      (compilation) => {
        if (!compiler.watchMode) return

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
