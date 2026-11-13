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

type Paths = Iterable<string>
type Times = Map<string, unknown> | undefined
type Changes = Set<string> | undefined

interface WatchInfo {
  changes?: Set<string>
  removals?: Set<string>
  fileTimeInfoEntries?: Map<string, unknown>
  contextTimeInfoEntries?: Map<string, unknown>
}

interface WatchHandle {
  getInfo?: () => WatchInfo
}

type WatchCallback = (
  error: Error | null,
  fileTimes?: Times,
  contextTimes?: Times,
  changes?: Changes,
  removals?: Changes
) => void

type WatchCallbackUndelayed = (fileName: string, changeTime: number) => void

type Watch = (
  files: Paths,
  directories: Paths,
  missing: Paths,
  startTime: number,
  options: object,
  callback: WatchCallback,
  callbackUndelayed?: WatchCallbackUndelayed
) => WatchHandle | undefined

interface WatchFileSystem {
  watch?: Watch
}

export interface WatchRealProjectPathOptions {
  realpath?: (target: string) => string
}

// Maps paths under a linked folder to its real one, and remembers every
// spelling it was asked for so an answer can go back under each of them.
export class LinkedFolder {
  private readonly asked = new Map<string, Set<string>>()

  constructor(
    private readonly linked: string,
    private readonly real: string
  ) {}

  public toReal(target: string): string {
    if (target === this.linked) return this.real

    return target.startsWith(this.linked + path.sep)
      ? this.real + target.slice(this.linked.length)
      : target
  }

  public realPaths(targets: Paths): string[] {
    const out = new Set<string>()

    for (const target of targets) {
      const real = this.toReal(target)
      const spellings = this.asked.get(real) ?? new Set<string>()

      spellings.add(target)
      this.asked.set(real, spellings)
      out.add(real)
    }

    return [...out]
  }

  public askedPaths(real: string): string[] {
    const spellings = this.asked.get(real)

    return spellings ? [...spellings] : [real]
  }

  public askedSet(reals: Changes): Changes {
    if (!reals) return reals

    const out = new Set<string>()

    for (const real of reals) {
      for (const spelling of this.askedPaths(real)) out.add(spelling)
    }

    return out
  }

  public askedTimes(times: Times): Times {
    if (!times) return times

    const out = new Map<string, unknown>()

    for (const [real, value] of times) {
      for (const spelling of this.askedPaths(real)) out.set(spelling, value)
    }

    return out
  }
}

// The bundler names modules by real path while the project's other files
// keep the linked one, so a linked root was watched as two folder chains.
export class WatchRealProjectPathPlugin {
  public static readonly name: string =
    'plugin-compilation:watch-real-project-path'

  private readonly realpath: (target: string) => string

  constructor(options: WatchRealProjectPathOptions = {}) {
    this.realpath = options.realpath ?? fs.realpathSync
  }

  private linkedFolder(compiler: Compiler): LinkedFolder | undefined {
    const context = compiler.context || compiler.options.context

    if (!context) return undefined

    try {
      const real = this.realpath(context)

      return real === context ? undefined : new LinkedFolder(context, real)
    } catch {
      // A context that can not be resolved is watched as written.
      return undefined
    }
  }

  private wrap(compiler: Compiler): void {
    const watchFileSystem = compiler.watchFileSystem as
      | WatchFileSystem
      | undefined

    if (typeof watchFileSystem?.watch !== 'function') return

    const watch = watchFileSystem.watch.bind(watchFileSystem)

    const purge = (changes: Changes) => {
      const inputFileSystem = compiler.inputFileSystem as
        | {purge?: (target: string) => void}
        | undefined

      // The watcher cleared the real spelling. Readers ask by the linked one.
      for (const target of changes ?? []) inputFileSystem?.purge?.(target)
    }

    watchFileSystem.watch = (
      files,
      directories,
      missing,
      startTime,
      options,
      callback,
      callbackUndelayed
    ) => {
      // Looked up per call, so a project linked or unlinked later is seen.
      const folder = this.linkedFolder(compiler)

      if (!folder) {
        return watch(
          files,
          directories,
          missing,
          startTime,
          options,
          callback,
          callbackUndelayed
        )
      }

      const handle = watch(
        folder.realPaths(files),
        folder.realPaths(directories),
        folder.realPaths(missing),
        startTime,
        options,
        (error, fileTimes, contextTimes, changes, removals) => {
          const changed = folder.askedSet(changes)
          const removed = folder.askedSet(removals)

          purge(changed)
          purge(removed)
          callback(
            error,
            folder.askedTimes(fileTimes),
            folder.askedTimes(contextTimes),
            changed,
            removed
          )
        },
        callbackUndelayed
          ? (fileName, changeTime) =>
              callbackUndelayed(folder.askedPaths(fileName)[0], changeTime)
          : undefined
      )

      if (!handle || typeof handle.getInfo !== 'function') return handle

      const getInfo = handle.getInfo.bind(handle)

      handle.getInfo = () => {
        const info = getInfo()
        const changes = folder.askedSet(info.changes)
        const removals = folder.askedSet(info.removals)

        purge(changes)
        purge(removals)

        return {
          ...info,
          changes,
          removals,
          fileTimeInfoEntries: folder.askedTimes(info.fileTimeInfoEntries),
          contextTimeInfoEntries: folder.askedTimes(info.contextTimeInfoEntries)
        }
      }

      return handle
    }
  }

  public apply(compiler: Compiler): void {
    if (compiler.options.experiments?.nativeWatcher) return
    // A stand-in compiler without watch hooks has no watcher to wrap.
    if (typeof compiler.hooks?.watchRun?.tap !== 'function') return

    let wrapped = false

    compiler.hooks.watchRun.tap(
      {name: WatchRealProjectPathPlugin.name, stage: -10000},
      () => {
        if (wrapped) return

        wrapped = true
        this.wrap(compiler)
      }
    )
  }
}
