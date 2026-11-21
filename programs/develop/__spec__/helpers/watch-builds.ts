import * as path from 'node:path'
import type {Compiler, Stats} from '@rspack/core'

type WatchOptions = Parameters<Compiler['watch']>[0]

export interface WatchBuilds {
  first: Promise<Stats>
  after: (files: string[], write: () => void) => Promise<Stats>
  close: () => Promise<void>
}

// A watch whose builds a spec can tell apart: the first one, and the one
// that compiled a given write. Age the fixture before the watch starts.
export function watchBuilds(
  compiler: Compiler,
  watchOptions: WatchOptions
): WatchBuilds {
  let started = 0
  let wanted: (() => boolean) | undefined
  let settle:
    | {resolve: (stats: Stats) => void; reject: (error: Error) => void}
    | undefined
  const buildThat = (matches: () => boolean) =>
    new Promise<Stats>((resolve, reject) => {
      wanted = matches
      settle = {resolve, reject}
    })

  compiler.hooks.watchRun.tap('spec:watch-builds', () => {
    started += 1
  })

  const first = buildThat(() => true)
  const watching = compiler.watch(watchOptions, (error, stats) => {
    if (!error && (!stats || !wanted?.())) return

    const waiting = settle
    wanted = undefined
    settle = undefined

    if (error) waiting?.reject(error)
    else if (stats) waiting?.resolve(stats)
  })

  return {
    first,
    after(files, write) {
      const before = started
      const unseen = new Set(files.map((file) => path.basename(file)))
      // A build already running may have read a file before the write, so
      // only builds that start later count, until they have named each file.
      const build = buildThat(() => {
        if (started <= before) return false

        for (const changed of compiler.modifiedFiles || []) {
          unseen.delete(path.basename(changed))
        }

        return unseen.size === 0
      })
      write()

      return build
    },
    close: () =>
      new Promise<void>((resolve) => {
        watching.close(() => resolve())
      })
  }
}
