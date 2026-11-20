// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import type {Compiler} from '@rspack/core'
import {debugLine, isDebug} from '../lib/messaging'
import * as messages from './messages'

// Past this many open files the rest wait for the folder events alone.
const MAX_FILE_WATCHES = 2000
const MAX_FOLDER_POLLS = 500
// A folder's own mtime moves when an entry is added, removed or renamed.
const FOLDER_POLL_MS = 300

interface DirectoryWatcherLike {
  onWatchEvent?: (eventType: string, filename: string) => void
  doScan?: (initial: boolean) => void
  scanning?: boolean
  closed?: boolean
  files?: Map<string, unknown>
}

interface FileWatcherLike {
  directoryWatcher?: unknown
  emit?: (event: string, type: string) => void
}

interface WatchpackLike {
  fileWatchers?: Map<string, {watcher?: FileWatcherLike}>
  watcherManager?: {directoryWatchers?: Map<string, unknown>}
}

interface AssistedWatchFileSystem {
  watcher?: WatchpackLike | null
  watch?: (...args: unknown[]) => unknown
}

export interface FileEventAssistOptions {
  platform?: NodeJS.Platform
  watchFile?: (file: string, listener: (type: string) => void) => fs.FSWatcher
  // Returns the function that stops the poll.
  pollFolder?: (folder: string, onChange: () => void) => () => void
  maxWatches?: number
}

const guarded = new WeakSet<object>()
let saidGuardOff = false

// The watcher queues a scan asked for mid-scan and then never runs it, which
// leaves the folder scanning for good. Such a scan is held here instead and
// run once the one in flight ends, whoever asked: a poll or the watcher.
function guardScans(owner: DirectoryWatcherLike | undefined) {
  if (!owner || guarded.has(owner)) return

  guarded.add(owner)

  const missing = [
    typeof owner.doScan === 'function' ? '' : 'doScan',
    typeof owner.scanning === 'boolean' ? '' : 'scanning'
  ].filter(Boolean)

  if (missing.length > 0 || !owner.doScan) {
    if (!saidGuardOff && isDebug()) {
      saidGuardOff = true
      debugLine(messages.debugFolderScanGuardOff(missing))
    }

    return
  }

  const scan = owner.doScan.bind(owner)
  let held = false

  const runHeld = () => {
    if (owner.closed) return

    if (owner.scanning) {
      setTimeout(runHeld, FOLDER_POLL_MS).unref()

      return
    }

    held = false
    scan(false)
  }

  owner.doScan = (initial: boolean) => {
    if (!owner.scanning) return scan(initial)
    if (held) return

    held = true
    setTimeout(runHeld, FOLDER_POLL_MS).unref()
  }
}

function pollFolderMtime(folder: string, onChange: () => void) {
  const listener = (current: fs.Stats, previous: fs.Stats) => {
    if (current.mtimeMs !== previous.mtimeMs) onChange()
  }

  fs.watchFile(folder, {interval: FOLDER_POLL_MS, persistent: false}, listener)

  return () => fs.unwatchFile(folder, listener)
}

function isWithin(target: string, root: string): boolean {
  const relative = path.relative(root, target)

  return !relative.startsWith('..') && !path.isAbsolute(relative)
}

function inProject(target: string, roots: string[]): boolean {
  if (target.split(path.sep).includes('node_modules')) return false

  return roots.some((root) => isWithin(target, root))
}

// On macOS a folder watch rides FSEvents, which a busy machine can hold back
// for tens of seconds. A file watch (kqueue) and a folder stat poll do not.
export class FileEventAssistPlugin {
  public static readonly name = 'dev-server:file-event-assist'

  private readonly platform: NodeJS.Platform
  private readonly maxWatches: number
  private readonly watchFile: NonNullable<FileEventAssistOptions['watchFile']>
  private readonly pollFolder: NonNullable<FileEventAssistOptions['pollFolder']>
  private readonly watches = new Map<string, fs.FSWatcher>()
  private readonly polls = new Map<string, () => void>()

  constructor(options: FileEventAssistOptions = {}) {
    this.platform = options.platform ?? process.platform
    this.maxWatches = options.maxWatches ?? MAX_FILE_WATCHES
    this.watchFile =
      options.watchFile ??
      ((file, listener) =>
        fs.watch(file, {persistent: false}, (type) => listener(type)))

    this.pollFolder = options.pollFolder ?? pollFolderMtime
  }

  private roots(compiler: Compiler): string[] {
    const context = String(compiler.context || compiler.options.context || '')

    if (!context) return []

    try {
      const real = fs.realpathSync(context)

      return real === context ? [context] : [context, real]
    } catch {
      return [context]
    }
  }

  // Hands the event to the folder watcher that owns the file, so the bundler
  // runs its own stat and the late folder event finds nothing new.
  private forward(
    watchFileSystem: AssistedWatchFileSystem,
    file: string,
    type: string
  ) {
    const fileWatcher =
      watchFileSystem.watcher?.fileWatchers?.get(file)?.watcher
    const owner = fileWatcher?.directoryWatcher as
      | DirectoryWatcherLike
      | undefined

    owner?.onWatchEvent?.(type, path.basename(file))

    // A file deleted between the first scan's listing and its stat is never
    // recorded, so the folder watcher would report nothing for it.
    if (type === 'rename' && !fs.existsSync(file) && !owner?.files?.has(file)) {
      fileWatcher?.emit?.('remove', 'rename')
    }
  }

  private open(watchFileSystem: AssistedWatchFileSystem, file: string) {
    if (this.watches.has(file) || this.watches.size >= this.maxWatches) return

    try {
      const opened = fs.statSync(file)

      if (!opened.isFile()) return

      const onEvent = (type: string) => {
        this.forward(watchFileSystem, file, type)

        // A save that replaces the file leaves this handle on the old inode.
        if (type === 'rename') {
          this.close(file)
          setImmediate(() => this.open(watchFileSystem, file))
        }
      }

      const handle = this.watchFile(file, onEvent)

      handle.on('error', () => this.close(file))
      this.watches.set(file, handle)

      // The watch is armed at the next poll phase, which the second immediate
      // follows, so a write in between is found by comparing the file itself.
      setImmediate(() =>
        setImmediate(() => {
          if (this.watches.get(file) !== handle) return

          try {
            if (fs.statSync(file).mtimeMs !== opened.mtimeMs) onEvent('change')
          } catch {
            onEvent('rename')
          }
        })
      )
    } catch {
      // A file gone before it could be opened has only the folder watch.
    }
  }

  private close(file: string) {
    const handle = this.watches.get(file)

    this.watches.delete(file)

    try {
      handle?.close()
    } catch {
      // Already closed.
    }
  }

  // A file added, removed or renamed shows only in its folder, so the folder
  // watcher scans again once the folder's mtime moves.
  private syncFolders(
    watchFileSystem: AssistedWatchFileSystem,
    roots: string[]
  ) {
    const folders = watchFileSystem.watcher?.watcherManager?.directoryWatchers
    const wanted = new Set<string>()

    for (const [folder, owner] of folders ?? []) {
      if (!inProject(folder, roots)) continue

      wanted.add(folder)
      // Past the poll cap too: the watcher's own scans can still collide.
      guardScans(owner as DirectoryWatcherLike)
    }

    for (const [folder, stop] of [...this.polls]) {
      if (wanted.has(folder)) continue

      stop()
      this.polls.delete(folder)
    }

    for (const folder of wanted) {
      if (this.polls.has(folder) || this.polls.size >= MAX_FOLDER_POLLS) {
        continue
      }

      const rescan = () => {
        if (!this.polls.has(folder)) return

        const owner =
          watchFileSystem.watcher?.watcherManager?.directoryWatchers?.get(
            folder
          ) as DirectoryWatcherLike | undefined

        guardScans(owner)
        owner?.doScan?.(false)
      }

      const stop = this.pollFolder(folder, rescan)

      this.polls.set(folder, stop)
    }
  }

  private sync(compiler: Compiler, watchFileSystem: AssistedWatchFileSystem) {
    const files = watchFileSystem.watcher?.fileWatchers

    if (!files) return

    const roots = this.roots(compiler)
    const wanted = new Set<string>()

    for (const file of files.keys()) {
      if (inProject(file, roots)) wanted.add(file)
    }

    for (const file of [...this.watches.keys()]) {
      if (!wanted.has(file)) this.close(file)
    }

    for (const file of wanted) this.open(watchFileSystem, file)
    this.syncFolders(watchFileSystem, roots)
  }

  public apply(compiler: Compiler): void {
    if (this.platform !== 'darwin') return
    if (compiler.options.experiments?.nativeWatcher) return
    if (typeof compiler.hooks?.watchRun?.tap !== 'function') return

    let wrapped = false

    compiler.hooks.watchRun.tap(FileEventAssistPlugin.name, () => {
      if (wrapped) return

      wrapped = true

      const watchFileSystem = compiler.watchFileSystem as
        | AssistedWatchFileSystem
        | undefined
      const watch = watchFileSystem?.watch

      // Polling reads every file itself, so it needs no help.
      if (!watchFileSystem || typeof watch !== 'function') return
      if (compiler.watching?.watchOptions?.poll) return

      watchFileSystem.watch = (...args: unknown[]) => {
        const handle = watch.apply(watchFileSystem, args)

        this.sync(compiler, watchFileSystem)

        return handle
      }
    })

    compiler.hooks.watchClose.tap(FileEventAssistPlugin.name, () => {
      for (const file of [...this.watches.keys()]) this.close(file)
      for (const stop of this.polls.values()) stop()
      this.polls.clear()
    })
  }
}
