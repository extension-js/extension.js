import * as fs from 'node:fs'
import * as path from 'node:path'
import {rspack} from '@rspack/core'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {trackTempFolders} from '../../__spec__/helpers/temp-folders'
import {FileRequestsPlugin} from '../resolve-file-requests'

const makeTempFolder = trackTempFolders()
const root = path.join(path.sep, 'work', 'project')
const entry = path.join(root, 'background.js')

function plugin(files: string[]) {
  return new FileRequestsPlugin({isFile: (target) => files.includes(target)})
}

type BeforeResolve = (data: {context?: string; request?: string}) => void

// A compiler that only records the resolve tap it is given.
function standIn(watchMode: boolean) {
  const taps: BeforeResolve[] = []
  const compiler = {
    watchMode,
    hooks: {
      normalModuleFactory: {
        tap: (_name: string, withFactory: (factory: unknown) => void) =>
          withFactory({
            hooks: {
              beforeResolve: {
                tap: (_tapName: string, fn: BeforeResolve) => taps.push(fn)
              }
            }
          })
      }
    }
  }

  return {compiler: compiler as never, taps}
}

describe('FileRequestsPlugin rewrite', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('asks for a whole path to a file by its folder and its name', () => {
    expect(plugin([entry]).rewrite(entry)).toEqual({
      context: root,
      request: './background.js'
    })
  })

  it('keeps the query of the request', () => {
    expect(plugin([entry]).rewrite(`${entry}?raw`)).toEqual({
      context: root,
      request: './background.js?raw'
    })
  })

  it('keeps the folder as spelled when a short name stands for a long one', () => {
    // What a Windows temp folder looks like: the real path spells it out.
    const short = path.join(path.sep, 'Users', 'RUNNER~1', 'Temp', 'project')
    const file = path.join(short, 'background.js')

    expect(plugin([file]).rewrite(file)?.context).toBe(short)
  })

  it('never asks the disk for a real path, which would rename the module', () => {
    const base = makeTempFolder('extjs-file-requests-spelling-')
    const file = path.join(base, 'background.js')

    fs.writeFileSync(file, '')

    const native = vi.spyOn(fs.realpathSync, 'native')
    const rewritten = new FileRequestsPlugin().rewrite(file)

    // The temp folder is behind a link on macOS and a short name on Windows.
    expect(rewritten).toEqual({context: base, request: './background.js'})
    expect(native).not.toHaveBeenCalled()
  })

  it('leaves a path from the project root to the resolver', () => {
    // `/img/logo.png` is a file of the public folder, not of the disk root.
    expect(plugin([entry]).rewrite('/img/logo.png')).toBeUndefined()
  })

  it('leaves relative, bare, loader and fragment requests alone', () => {
    const all = new FileRequestsPlugin({isFile: () => true})

    expect(all.rewrite('./background.js')).toBeUndefined()
    expect(all.rewrite('react')).toBeUndefined()
    expect(all.rewrite(`loader.js!${entry}`)).toBeUndefined()
    expect(all.rewrite(`${entry}#part`)).toBeUndefined()
    expect(all.rewrite('')).toBeUndefined()
  })

  it('rewrites for a watcher and leaves a one-off build alone', () => {
    const options = {isFile: () => true, platform: 'linux' as const}
    const watching = standIn(true)
    const building = standIn(false)

    new FileRequestsPlugin(options).apply(watching.compiler)
    new FileRequestsPlugin(options).apply(building.compiler)

    const watched = {context: path.sep, request: entry}
    const built = {context: path.sep, request: entry}

    watching.taps[0](watched)
    building.taps[0](built)

    expect(watched).toEqual({context: root, request: './background.js'})
    expect(built).toEqual({context: path.sep, request: entry})
  })

  it('taps nothing on Windows, where a drive path is never tried under a root', () => {
    const {compiler, taps} = standIn(true)

    new FileRequestsPlugin({isFile: () => true, platform: 'win32'}).apply(
      compiler
    )

    expect(taps).toEqual([])
  })

  it('does nothing on a stand-in compiler without a module factory', () => {
    expect(() =>
      new FileRequestsPlugin().apply({hooks: {}} as never)
    ).not.toThrow()
  })
})

describe('FileRequestsPlugin under a real build', () => {
  const closers: Array<() => Promise<void>> = []

  afterEach(async () => {
    for (const close of closers.splice(0)) await close()
  })

  async function firstWatchCall(withPlugin: boolean) {
    const base = fs.realpathSync(makeTempFolder('extjs-file-requests-'))
    const project = path.join(base, 'project')

    // The entry sits below the context, so its own folder has to be used.
    fs.mkdirSync(path.join(project, 'src'), {recursive: true})
    fs.writeFileSync(
      path.join(project, 'src', 'entry.js'),
      'import "./dep.js"\n'
    )

    fs.writeFileSync(path.join(project, 'src', 'dep.js'), 'console.log(1)\n')

    const compiler = rspack({
      mode: 'development',
      context: project,
      entry: {main: path.join(project, 'src', 'entry.js')},
      output: {path: path.join(base, 'out')},
      resolve: {roots: [path.join(project, 'public'), project]},
      stats: false
    })

    if (withPlugin) new FileRequestsPlugin().apply(compiler)

    const seen = await new Promise<{files: string[]; missing: string[]}>(
      (resolve, reject) => {
        const watchFileSystem = compiler.watchFileSystem as unknown as {
          watch: (
            files: Iterable<string>,
            directories: Iterable<string>,
            missing: Iterable<string>,
            ...rest: unknown[]
          ) => unknown
        }
        const watch = watchFileSystem.watch.bind(watchFileSystem)

        watchFileSystem.watch = (files, directories, missing, ...rest) => {
          const call = {files: [...files], missing: [...missing]}

          resolve(call)

          return watch(call.files, directories, call.missing, ...rest)
        }

        const watching = compiler.watch({aggregateTimeout: 50}, (error) => {
          if (error) reject(error)
        })

        closers.push(
          () =>
            new Promise<void>((done) => {
              watching.close(() => done())
            })
        )
      }
    )

    return {
      project,
      files: seen.files,
      // A whole path joined under a root repeats the temp base in it.
      joined: seen.missing.filter((target) => target.indexOf(base, 1) !== -1)
    }
  }

  it('keeps the resolver from trying the roots for an entry named by its whole path', async () => {
    const {project, files, joined} = await firstWatchCall(true)

    expect(files).toEqual(
      expect.arrayContaining([
        path.join(project, 'src', 'entry.js'),
        path.join(project, 'src', 'dep.js')
      ])
    )

    expect(joined).toEqual([])
  }, 60000)

  // The bundler's own resolver does this. If a release stops, the plugin can go.
  it.skipIf(process.platform === 'win32')(
    'is still needed off Windows, where a drive path is never joined under a root: without it the roots are tried first',
    async () => {
      const {joined} = await firstWatchCall(false)

      expect(joined.length).toBeGreaterThan(0)
    },
    60000
  )

  function bytesProject() {
    const base = fs.realpathSync(makeTempFolder('extjs-file-requests-bytes-'))
    const project = path.join(base, 'project')

    fs.mkdirSync(path.join(project, 'src'), {recursive: true})
    fs.writeFileSync(
      path.join(project, 'src', 'entry.js'),
      'import value from "./dep.js"\nconsole.log(value)\n'
    )

    fs.writeFileSync(
      path.join(project, 'src', 'dep.js'),
      'module.exports = 1\n'
    )

    return {base, project}
  }

  async function productionBuild(
    {base, project}: {base: string; project: string},
    withPlugin: boolean
  ) {
    const out = path.join(base, withPlugin ? 'out-with' : 'out-without')

    const compiler = rspack({
      mode: 'production',
      context: project,
      entry: {main: path.join(project, 'src', 'entry.js')},
      output: {path: out},
      optimization: {concatenateModules: false, minimize: false},
      resolve: {roots: [path.join(project, 'public'), project]},
      stats: false
    })

    if (withPlugin) new FileRequestsPlugin().apply(compiler)

    const modules = await new Promise<string[]>((resolve, reject) => {
      compiler.run((error, stats) => {
        if (error || !stats) return reject(error)

        const json = stats.toJson({all: false, modules: true, ids: true})

        compiler.close(() =>
          resolve(
            (json.modules ?? []).map((module) => `${module.id} ${module.name}`)
          )
        )
      })
    })

    return {
      modules,
      bytes: fs.readFileSync(path.join(out, 'main.js'), 'utf-8')
    }
  }

  it('gives a production build the ids and bytes it has without the plugin', async () => {
    const made = bytesProject()
    const withPlugin = await productionBuild(made, true)
    const without = await productionBuild(made, false)

    expect(withPlugin.modules.length).toBeGreaterThan(0)
    expect(withPlugin.modules).toEqual(without.modules)
    expect(withPlugin.bytes).toBe(without.bytes)
  }, 60000)
})
