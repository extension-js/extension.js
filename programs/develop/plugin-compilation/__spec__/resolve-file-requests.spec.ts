import * as fs from 'node:fs'
import * as path from 'node:path'
import {rspack} from '@rspack/core'
import {afterEach, describe, expect, it} from 'vitest'
import {useTempFolders} from '../../__spec__/helpers/temp-folders'
import {FileRequestsPlugin} from '../resolve-file-requests'

const makeTempFolder = useTempFolders()
const root = path.join(path.sep, 'work', 'project')
const entry = path.join(root, 'background.js')

function plugin(files: string[], real: Record<string, string> = {}) {
  return new FileRequestsPlugin({
    isFile: (target) => files.includes(target),
    realpath: (target) => real[target] ?? target
  })
}

describe('FileRequestsPlugin rewrite', () => {
  it('asks for a whole path to a file by its folder and its name', () => {
    expect(plugin([entry]).rewrite(entry, true)).toEqual({
      context: root,
      request: './background.js'
    })
  })

  it('keeps the query of the request', () => {
    expect(plugin([entry]).rewrite(`${entry}?raw`, true)).toEqual({
      context: root,
      request: './background.js?raw'
    })
  })

  it('names the folder by its real path, unless links are kept', () => {
    const real = path.join(path.sep, 'private', 'work', 'project')
    const linked = plugin([entry], {[root]: real})

    expect(linked.rewrite(entry, true)?.context).toBe(real)
    expect(linked.rewrite(entry, false)?.context).toBe(root)
  })

  it('reads the real path of a folder once', () => {
    let reads = 0
    const counted = new FileRequestsPlugin({
      isFile: () => true,
      realpath: (target) => {
        reads++

        return target
      }
    })

    counted.rewrite(entry, true)
    counted.rewrite(path.join(root, 'other.js'), true)

    expect(reads).toBe(1)
  })

  it('leaves a path from the project root to the resolver', () => {
    // `/img/logo.png` is a file of the public folder, not of the disk root.
    expect(plugin([entry]).rewrite('/img/logo.png', true)).toBeUndefined()
  })

  it('leaves relative, bare, loader and fragment requests alone', () => {
    const all = new FileRequestsPlugin({isFile: () => true})

    expect(all.rewrite('./background.js', true)).toBeUndefined()
    expect(all.rewrite('react', true)).toBeUndefined()
    expect(all.rewrite(`loader.js!${entry}`, true)).toBeUndefined()
    expect(all.rewrite(`${entry}#part`, true)).toBeUndefined()
    expect(all.rewrite('', true)).toBeUndefined()
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
  it('is still needed: without it the roots are tried first', async () => {
    const {joined} = await firstWatchCall(false)

    expect(joined.length).toBeGreaterThan(0)
  }, 60000)
})
