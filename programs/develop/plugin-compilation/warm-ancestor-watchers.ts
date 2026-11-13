//  ██████╗ ██████╗ ███╗   ███╗██████╗ ██╗██╗      █████╗ ████████╗██╗ ██████╗ ███╗   ██╗
// ██╔════╝██╔═══██╗████╗ ████║██╔══██╗██║██║     ██╔══██╗╚══██╔══╝██║██╔═══██╗████╗  ██║
// ██║     ██║   ██║██╔████╔██║██████╔╝██║██║     ███████║   ██║   ██║██║   ██║██╔██╗ ██║
// ██║     ██║   ██║██║╚██╔╝██║██╔═══╝ ██║██║     ██╔══██║   ██║   ██║██║   ██║██║╚██╗██║
// ╚██████╗╚██████╔╝██║ ╚═╝ ██║██║     ██║███████╗██║  ██║   ██║   ██║╚██████╔╝██║ ╚████║
//  ╚═════╝ ╚═════╝ ╚═╝     ╚═╝╚═╝     ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚═╝ ╚═════╝ ╚═╝  ╚═══╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import type {Compiler} from '@rspack/core'

const SCAN_POLL_MS = 20
// A scan that outlasts this is left to finish after ready, as it did before.
const SCAN_WAIT_CAP_MS = 30000

interface ScannedDirectory {
  initialScan?: boolean
  closed?: boolean
}

interface WatcherInternals {
  watcherManager?: {directoryWatchers?: Map<string, ScannedDirectory>}
}

interface WarmableWatchFileSystem {
  watcher?: WatcherInternals | null
  watch?: (
    files: Iterable<string>,
    directories: Iterable<string>,
    missing: Iterable<string>,
    startTime: number,
    options: object,
    callback: () => void,
    callbackUndelayed: () => void
  ) => {close?: () => void} | undefined
}

interface WarmScan {
  handle: {close?: () => void} | undefined
  watcher: WatcherInternals
  scanned: Promise<void>
}

export interface WarmAncestorWatchersOptions {
  platform?: NodeJS.Platform
  realpath?: (target: string) => string
  pollMs?: number
  waitCapMs?: number
}

function scansFinished(watcher: WatcherInternals): boolean {
  const directories = watcher.watcherManager?.directoryWatchers

  if (!directories || typeof directories.values !== 'function') return true

  for (const directory of directories.values()) {
    if (directory?.initialScan === true && directory.closed !== true) {
      return false
    }
  }

  return true
}

// On macOS the watcher stats every entry of every ancestor folder once. That
// began after ready and held the first save, so it now ends before ready.
export class WarmAncestorWatchersPlugin {
  public static readonly name: string =
    'plugin-compilation:warm-ancestor-watchers'

  private readonly platform: NodeJS.Platform
  private readonly realpath: (target: string) => string
  private readonly pollMs: number
  private readonly waitCapMs: number

  constructor(options: WarmAncestorWatchersOptions = {}) {
    this.platform = options.platform ?? process.platform
    this.realpath = options.realpath ?? fs.realpathSync
    this.pollMs = options.pollMs ?? SCAN_POLL_MS
    this.waitCapMs = options.waitCapMs ?? SCAN_WAIT_CAP_MS
  }

  private ancestorTargets(context: string): string[] {
    const targets = [context]

    try {
      // Module paths reach the watcher resolved, so a linked root is two chains.
      const resolved = this.realpath(context)

      if (resolved !== context) targets.push(resolved)
    } catch {
      // A context that can not be resolved is watched as written.
    }

    // The watcher never watches the disk root, so nothing is warmed under it.
    return targets.filter((target) => {
      const parent = path.dirname(target)

      return path.dirname(parent) !== parent
    })
  }

  private whenScanned(watcher: WatcherInternals): Promise<void> {
    const giveUpAt = Date.now() + this.waitCapMs

    return new Promise<void>((resolve) => {
      const poll = () => {
        let finished = true

        try {
          finished = scansFinished(watcher)
        } catch {
          // A watcher shaped another way is not waited for.
        }

        if (finished || Date.now() >= giveUpAt) return resolve()

        setTimeout(poll, this.pollMs).unref?.()
      }

      poll()
    })
  }

  private startScan(compiler: Compiler): WarmScan | undefined {
    const context = compiler.context || compiler.options.context
    const watchFileSystem = compiler.watchFileSystem as
      | WarmableWatchFileSystem
      | undefined
    const watchOptions = compiler.watching?.watchOptions

    if (!context || !watchOptions || watchOptions.poll) return undefined
    if (typeof watchFileSystem?.watch !== 'function') return undefined

    const targets = this.ancestorTargets(context)

    if (targets.length === 0) return undefined

    try {
      // Named as a file of its parent, the project keeps its own first scan
      // for the real watch, and that scan is what catches a save made by then.
      const handle = watchFileSystem.watch(
        targets,
        [],
        [],
        Date.now(),
        watchOptions,
        () => {},
        () => {}
      )
      const watcher = watchFileSystem.watcher

      if (!watcher) return undefined

      return {handle, watcher, scanned: this.whenScanned(watcher)}
    } catch {
      // Warming is an optimization, so the session goes on without it.
      return undefined
    }
  }

  public apply(compiler: Compiler): void {
    // Only macOS chains a watched folder to its ancestors.
    if (this.platform !== 'darwin') return
    if (compiler.options.experiments?.nativeWatcher) return
    // A stand-in compiler without async hooks has no watcher to warm.
    if (typeof compiler.hooks.done?.tapPromise !== 'function') return

    let started = false
    let warm: WarmScan | undefined

    // First in line, so every ready stamp a later tap writes comes after it.
    // After the build, not beside it: the scan and the build slow each other.
    compiler.hooks.done.tapPromise(
      {name: WarmAncestorWatchersPlugin.name, stage: -10000},
      async () => {
        if (started || !compiler.watching) return

        started = true
        warm = this.startScan(compiler)

        if (warm) await warm.scanned
      }
    )

    compiler.hooks.watchClose.tap(WarmAncestorWatchersPlugin.name, () => {
      const watchFileSystem = compiler.watchFileSystem as
        | WarmableWatchFileSystem
        | undefined

      // The first real watch replaces and closes the warm one. Only a session
      // closed before that still holds it.
      if (warm && watchFileSystem?.watcher === warm.watcher) {
        try {
          warm.handle?.close?.()
        } catch {
          // Closing is best effort while the session is going away.
        }
      }

      warm = undefined
    })
  }
}
