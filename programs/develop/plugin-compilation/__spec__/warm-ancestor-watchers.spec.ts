import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {type Compiler, rspack} from '@rspack/core'
import {afterEach, describe, expect, it} from 'vitest'
import {WarmAncestorWatchersPlugin} from '../warm-ancestor-watchers'

type Tap = {name: string; stage: number; fn: (...args: unknown[]) => unknown}

// Runs taps in stage order and in series, the way the bundler's hooks do.
function createHook() {
  const taps: Tap[] = []

  const add = (
    options: string | {name: string; stage?: number},
    fn: Tap['fn']
  ) => {
    const name = typeof options === 'string' ? options : options.name
    const stage = typeof options === 'string' ? 0 : (options.stage ?? 0)

    taps.push({name, stage, fn})
    taps.sort((a, b) => a.stage - b.stage)
  }

  return {
    tap: add,
    tapPromise: add,
    async call(...args: unknown[]) {
      for (const tap of taps) await tap.fn(...args)
    }
  }
}

interface FakeDirectory {
  initialScan: boolean
  closed?: boolean
}

function createFakeCompiler(
  options: {
    poll?: boolean
    nativeWatcher?: boolean
    context?: string
    watching?: boolean
  } = {}
) {
  const watchOptions = {poll: options.poll, aggregateTimeout: 200}
  const directories = new Map<string, FakeDirectory>()
  const watchCalls: unknown[][] = []
  let closed = 0
  const watchFileSystem: {
    watcher: unknown
    throwOnWatch: boolean
    watch: (...args: unknown[]) => {close: () => void}
  } = {
    watcher: null,
    throwOnWatch: false,
    watch(...args: unknown[]) {
      if (watchFileSystem.throwOnWatch) throw new Error('no watcher here')

      watchCalls.push(args)
      watchFileSystem.watcher = {
        watcherManager: {directoryWatchers: directories}
      }

      return {close: () => closed++}
    }
  }
  const hooks = {
    watchRun: createHook(),
    done: createHook(),
    watchClose: createHook()
  }
  const compiler = {
    context: options.context ?? path.join(path.sep, 'work', 'project'),
    options: {experiments: {nativeWatcher: options.nativeWatcher}},
    watching: options.watching === false ? undefined : {watchOptions},
    watchFileSystem,
    hooks
  }

  return {
    compiler,
    asCompiler: compiler as unknown as Compiler,
    watchOptions,
    directories,
    watchCalls,
    watchFileSystem,
    closedCount: () => closed
  }
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

describe('WarmAncestorWatchersPlugin', () => {
  it('starts the ancestor scan at the first done, once, with the session watch options', async () => {
    const fake = createFakeCompiler()
    const linked = path.join(path.sep, 'work', 'project')
    const resolved = path.join(path.sep, 'private', 'work', 'project')

    new WarmAncestorWatchersPlugin({
      platform: 'darwin',
      realpath: () => resolved
    }).apply(fake.asCompiler)

    await fake.compiler.hooks.watchRun.call()

    expect(fake.watchCalls).toEqual([])

    await fake.compiler.hooks.done.call()
    await fake.compiler.hooks.done.call()

    expect(fake.watchCalls).toHaveLength(1)

    const [files, directories, missing, startTime, options] = fake.watchCalls[0]

    // The project folder is a file of its parent: its own entries are not read.
    expect(files).toEqual([linked, resolved])
    expect(directories).toEqual([])
    expect(missing).toEqual([])
    expect(typeof startTime).toBe('number')
    expect(options).toBe(fake.watchOptions)
  })

  it('names the project folder once when it is not behind a link', async () => {
    const fake = createFakeCompiler()

    new WarmAncestorWatchersPlugin({
      platform: 'darwin',
      realpath: (target) => target
    }).apply(fake.asCompiler)

    await fake.compiler.hooks.done.call()

    expect(fake.watchCalls[0][0]).toEqual([fake.compiler.context])
  })

  it('warms nothing for a project right under the disk root', async () => {
    const fake = createFakeCompiler({context: path.join(path.sep, 'project')})

    new WarmAncestorWatchersPlugin({
      platform: 'darwin',
      realpath: (target) => target
    }).apply(fake.asCompiler)

    await fake.compiler.hooks.done.call()

    expect(fake.watchCalls).toEqual([])
  })

  it('holds the first done until the scan has finished, so the ready stamp comes after it', async () => {
    const fake = createFakeCompiler()
    const order: string[] = []

    fake.directories.set('/work', {initialScan: true})
    fake.directories.set('/', {initialScan: true})

    // Registered first and still run second: the stamp is what must wait.
    fake.compiler.hooks.done.tap('ready-stamp', () => {
      order.push('ready-stamp')
    })

    new WarmAncestorWatchersPlugin({
      platform: 'darwin',
      realpath: (target) => target,
      pollMs: 5
    }).apply(fake.asCompiler)

    const done = fake.compiler.hooks.done.call()

    await sleep(40)
    expect(order).toEqual([])

    fake.directories.get('/work')!.initialScan = false
    await sleep(40)
    expect(order).toEqual([])

    order.push('scan-finished')
    fake.directories.get('/')!.initialScan = false
    await done

    expect(order).toEqual(['scan-finished', 'ready-stamp'])
  })

  it('waits only on the first done', async () => {
    const fake = createFakeCompiler()

    new WarmAncestorWatchersPlugin({
      platform: 'darwin',
      realpath: (target) => target,
      pollMs: 5
    }).apply(fake.asCompiler)

    await fake.compiler.hooks.done.call()

    fake.directories.set('/work', {initialScan: true})

    let secondDone = false
    await Promise.race([
      fake.compiler.hooks.done.call().then(() => (secondDone = true)),
      sleep(1000)
    ])

    expect(secondDone).toBe(true)
  })

  it('stops waiting at the cap and on a watcher that was closed', async () => {
    const capped = createFakeCompiler()

    capped.directories.set('/work', {initialScan: true})
    new WarmAncestorWatchersPlugin({
      platform: 'darwin',
      realpath: (target) => target,
      pollMs: 5,
      waitCapMs: 30
    }).apply(capped.asCompiler)

    await capped.compiler.hooks.done.call()

    const closed = createFakeCompiler()

    closed.directories.set('/work', {initialScan: true, closed: true})
    new WarmAncestorWatchersPlugin({
      platform: 'darwin',
      realpath: (target) => target,
      pollMs: 5,
      waitCapMs: 60000
    }).apply(closed.asCompiler)

    let finished = false
    await Promise.race([
      closed.compiler.hooks.done.call().then(() => (finished = true)),
      sleep(2000)
    ])

    expect(finished).toBe(true)
  })

  it.each([
    ['Linux', {platform: 'linux' as const}, {}],
    ['Windows', {platform: 'win32' as const}, {}],
    ['a polling watcher', {platform: 'darwin' as const}, {poll: true}],
    [
      'the native watcher',
      {platform: 'darwin' as const},
      {nativeWatcher: true}
    ],
    [
      'a build that does not watch',
      {platform: 'darwin' as const},
      {watching: false}
    ]
  ])('does nothing on %s', async (_label, pluginOptions, compilerOptions) => {
    const fake = createFakeCompiler(compilerOptions)

    new WarmAncestorWatchersPlugin({
      ...pluginOptions,
      realpath: (target) => target
    }).apply(fake.asCompiler)

    await fake.compiler.hooks.done.call()

    expect(fake.watchCalls).toEqual([])
  })

  it('lets the session go on when the watcher refuses the early watch', async () => {
    const fake = createFakeCompiler()

    fake.watchFileSystem.throwOnWatch = true
    new WarmAncestorWatchersPlugin({
      platform: 'darwin',
      realpath: (target) => target
    }).apply(fake.asCompiler)

    await fake.compiler.hooks.done.call()
    await fake.compiler.hooks.watchClose.call()

    expect(fake.closedCount()).toBe(0)
  })

  it('closes the warm watcher only when no real watch replaced it', async () => {
    const early = createFakeCompiler()

    new WarmAncestorWatchersPlugin({
      platform: 'darwin',
      realpath: (target) => target
    }).apply(early.asCompiler)

    await early.compiler.hooks.done.call()
    await early.compiler.hooks.watchClose.call()

    expect(early.closedCount()).toBe(1)

    const replaced = createFakeCompiler()

    new WarmAncestorWatchersPlugin({
      platform: 'darwin',
      realpath: (target) => target
    }).apply(replaced.asCompiler)

    await replaced.compiler.hooks.done.call()
    replaced.watchFileSystem.watcher = {watcherManager: {}}
    await replaced.compiler.hooks.watchClose.call()

    expect(replaced.closedCount()).toBe(0)
  })
})

interface RealDirectoryWatcher {
  initialScan?: boolean
}

// The wait reads two fields of the bundler's own watcher. This runs the real
// one, so a release that renames them fails here instead of going quiet.
describe.skipIf(process.platform !== 'darwin')(
  'WarmAncestorWatchersPlugin under a real watch',
  () => {
    const roots: string[] = []
    const closers: Array<() => Promise<void>> = []

    afterEach(async () => {
      for (const close of closers.splice(0)) await close()

      for (const root of roots.splice(0)) {
        fs.rmSync(root, {recursive: true, force: true})
      }
    })

    it('has every ancestor scanned by the time the first done reaches a later tap', async () => {
      const root = fs.realpathSync(
        fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-warm-ancestors-'))
      )
      roots.push(root)
      const parent = path.join(root, 'parent')
      const project = path.join(parent, 'project')

      fs.mkdirSync(project, {recursive: true})

      for (let index = 0; index < 300; index++) {
        fs.writeFileSync(path.join(parent, `sibling-${index}.txt`), '')
      }

      fs.writeFileSync(path.join(project, 'entry.js'), 'export default 1\n')

      const compiler = rspack({
        mode: 'development',
        context: project,
        entry: {main: './entry.js'},
        output: {path: path.join(root, 'out')},
        stats: false
      })

      new WarmAncestorWatchersPlugin().apply(compiler)

      const seenAtDone = new Promise<Map<string, RealDirectoryWatcher>>(
        (resolve, reject) => {
          compiler.hooks.done.tap('read-watchers', () => {
            const watcher = (
              compiler.watchFileSystem as unknown as {
                watcher?: {
                  watcherManager?: {
                    directoryWatchers?: Map<string, RealDirectoryWatcher>
                  }
                }
              }
            ).watcher
            const directories = watcher?.watcherManager?.directoryWatchers

            if (!directories) {
              return reject(new Error('the warm watcher was not there at done'))
            }

            resolve(
              new Map(
                [...directories].map(([key, directory]) => [
                  key,
                  {initialScan: directory.initialScan}
                ])
              )
            )
          })
        }
      )
      const watching = compiler.watch({aggregateTimeout: 50}, () => {})

      closers.push(
        () =>
          new Promise<void>((resolve) => {
            watching.close(() => resolve())
          })
      )

      const directories = await seenAtDone
      const scanned = [...directories.entries()]

      // The folder that holds the project, and the one above it.
      expect(scanned.map(([key]) => key)).toEqual(
        expect.arrayContaining([parent, root])
      )

      expect(
        scanned.filter(([, directory]) => directory.initialScan !== false)
      ).toEqual([])
    }, 60000)
  }
)
