import * as path from 'node:path'
import type {Compiler} from '@rspack/core'
import {describe, expect, it} from 'vitest'
import {
  LinkedFolder,
  WatchRealProjectPathPlugin
} from '../watch-real-project-path'

const linked = path.join(path.sep, 'var', 'work', 'project')
const real = path.join(path.sep, 'private', 'var', 'work', 'project')

type WatchArgs = [
  string[],
  string[],
  string[],
  number,
  object,
  (...args: unknown[]) => void,
  ((fileName: string, changeTime: number) => void) | undefined
]

function createFakeCompiler(
  options: {context?: string; nativeWatcher?: boolean} = {}
) {
  const calls: WatchArgs[] = []
  const purged: string[] = []
  const info = {
    changes: new Set<string>(),
    removals: new Set<string>(),
    fileTimeInfoEntries: new Map<string, unknown>(),
    contextTimeInfoEntries: new Map<string, unknown>()
  }
  const watchRunTaps: Array<() => void> = []
  const compiler = {
    context: options.context ?? linked,
    options: {experiments: {nativeWatcher: options.nativeWatcher}},
    inputFileSystem: {purge: (target: string) => purged.push(target)},
    watchFileSystem: {
      watch(...args: WatchArgs) {
        calls.push(args)

        return {getInfo: () => info}
      }
    },
    hooks: {
      watchRun: {
        tap: (_options: unknown, fn: () => void) => watchRunTaps.push(fn)
      }
    }
  }

  return {
    compiler,
    asCompiler: compiler as unknown as Compiler,
    calls,
    purged,
    info,
    watchRun: () => {
      for (const tap of watchRunTaps) tap()
    }
  }
}

function watch(
  fake: ReturnType<typeof createFakeCompiler>,
  files: string[],
  directories: string[] = [],
  missing: string[] = []
) {
  const answers: unknown[][] = []
  const early: unknown[][] = []
  const handle = (
    fake.compiler.watchFileSystem.watch as unknown as (...args: unknown[]) => {
      getInfo: () => typeof fake.info
    }
  )(
    files,
    directories,
    missing,
    1,
    {},
    (...args: unknown[]) => answers.push(args),
    (...args: unknown[]) => early.push(args)
  )

  return {answers, early, handle}
}

describe('LinkedFolder', () => {
  it('maps the folder and what is below it, and nothing else', () => {
    const folder = new LinkedFolder(linked, real)

    expect(folder.toReal(linked)).toBe(real)
    expect(folder.toReal(path.join(linked, 'a', 'b.js'))).toBe(
      path.join(real, 'a', 'b.js')
    )

    // A sibling that only starts with the same letters is not below it.
    expect(folder.toReal(`${linked}-other`)).toBe(`${linked}-other`)
    expect(folder.toReal(path.join(path.sep, 'elsewhere'))).toBe(
      path.join(path.sep, 'elsewhere')
    )
  })

  it('names a file once when both spellings were asked for, and answers under both', () => {
    const folder = new LinkedFolder(linked, real)
    const both = [path.join(linked, 'a.js'), path.join(real, 'a.js')]

    expect(folder.realPaths(both)).toEqual([path.join(real, 'a.js')])
    expect(folder.askedPaths(path.join(real, 'a.js'))).toEqual(both)
    expect(folder.askedPaths(path.join(real, 'never-asked.js'))).toEqual([
      path.join(real, 'never-asked.js')
    ])
  })
})

describe('WatchRealProjectPathPlugin', () => {
  const apply = (fake: ReturnType<typeof createFakeCompiler>) => {
    new WatchRealProjectPathPlugin({
      realpath: (target) => (target === linked ? real : target)
    }).apply(fake.asCompiler)

    fake.watchRun()
    fake.watchRun()
  }

  it('hands the watcher the real path of everything under a linked project', () => {
    const fake = createFakeCompiler()
    const outside = path.join(path.sep, 'tools', 'shim.js')

    apply(fake)
    watch(
      fake,
      [path.join(linked, 'manifest.json'), path.join(real, 'a.js'), outside],
      [path.join(linked, 'public')],
      [path.join(linked, '.env'), linked]
    )

    expect(fake.calls).toHaveLength(1)
    expect(fake.calls[0][0]).toEqual([
      path.join(real, 'manifest.json'),
      path.join(real, 'a.js'),
      outside
    ])

    expect(fake.calls[0][1]).toEqual([path.join(real, 'public')])
    expect(fake.calls[0][2]).toEqual([path.join(real, '.env'), real])
  })

  it('answers a change under the path the build asked for', () => {
    const fake = createFakeCompiler()
    const manifest = path.join(linked, 'manifest.json')
    const module = path.join(real, 'a.js')

    apply(fake)

    const {answers, early} = watch(fake, [manifest, module])
    const [, , , , , callback, callbackUndelayed] = fake.calls[0]

    callbackUndelayed?.(path.join(real, 'manifest.json'), 5)
    callback(
      null,
      new Map([[path.join(real, 'manifest.json'), {safeTime: 1}]]),
      new Map(),
      new Set([path.join(real, 'manifest.json'), module]),
      new Set([path.join(real, 'gone.js')])
    )

    expect(early).toEqual([[manifest, 5]])

    const [error, fileTimes, , changes, removals] = answers[0]

    expect(error).toBeNull()
    expect([...(fileTimes as Map<string, unknown>).keys()]).toEqual([manifest])
    expect([...(changes as Set<string>)]).toEqual([manifest, module])
    expect([...(removals as Set<string>)]).toEqual([path.join(real, 'gone.js')])
    // Readers ask the cached file system by the linked spelling.
    expect(fake.purged).toContain(manifest)
  })

  it('answers the paused watcher info the same way', () => {
    const fake = createFakeCompiler()
    const manifest = path.join(linked, 'manifest.json')

    apply(fake)

    const {handle} = watch(fake, [manifest])

    fake.info.changes.add(path.join(real, 'manifest.json'))
    fake.info.fileTimeInfoEntries.set(path.join(real, 'manifest.json'), 1)

    const info = handle.getInfo()

    expect([...info.changes]).toEqual([manifest])
    expect([...info.fileTimeInfoEntries.keys()]).toEqual([manifest])
  })

  it('passes every call through untouched for a project that is not linked', () => {
    const fake = createFakeCompiler({context: real})
    const files = [path.join(real, 'a.js')]

    apply(fake)
    watch(fake, files)

    expect(fake.calls[0][0]).toBe(files)
  })

  it('stays out of the native watcher and of a stand-in compiler', () => {
    const native = createFakeCompiler({nativeWatcher: true})
    const before = native.compiler.watchFileSystem.watch

    apply(native)

    expect(native.compiler.watchFileSystem.watch).toBe(before)
    expect(() =>
      new WatchRealProjectPathPlugin().apply({
        options: {},
        hooks: {}
      } as unknown as Compiler)
    ).not.toThrow()
  })
})
