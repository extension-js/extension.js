import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'
import {PruneRemovedPublicFiles} from '../prune-removed-public-files'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

type Asset = {name: string; copied?: boolean}

function createProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-prune-public-'))
  roots.push(root)
  const publicDir = path.join(root, 'public')
  const outputPath = path.join(root, 'dist', 'chrome')
  fs.mkdirSync(publicDir, {recursive: true})
  fs.mkdirSync(outputPath, {recursive: true})

  const write = (base: string, name: string) => {
    const target = path.join(base, name)
    fs.mkdirSync(path.dirname(target), {recursive: true})
    fs.writeFileSync(target, `prune-public-token:${name}`)
  }

  return {
    publicDir,
    outputPath,
    ship(name: string): Asset {
      write(publicDir, name)
      write(outputPath, name)

      return {name, copied: true}
    },
    generate(name: string): Asset {
      write(outputPath, name)

      return {name}
    },
    removeSource(name: string) {
      fs.rmSync(path.join(publicDir, name))
    },
    inDist(name: string) {
      return fs.existsSync(path.join(outputPath, name))
    }
  }
}

function createCompiler(publicDir: string, outputPath: string) {
  const taps: Array<(stats: unknown) => void> = []
  const compiler = {
    options: {output: {path: outputPath}},
    hooks: {
      done: {
        tap: (_name: string, fn: (stats: unknown) => void) => taps.push(fn)
      }
    }
  }
  new PruneRemovedPublicFiles(publicDir).apply(compiler as never)

  return {
    finish(assets: Asset[], errors: Error[] = []) {
      const stats = {
        compilation: {
          errors,
          getAssets: () =>
            assets.map((asset) => ({
              name: asset.name,
              info: {copied: asset.copied === true}
            }))
        }
      }

      for (const fn of taps) fn(stats)
    }
  }
}

describe('PruneRemovedPublicFiles', () => {
  it('removes the copy of a deleted file and the folder it emptied, and nothing else', () => {
    const project = createProject()
    const kept = project.ship('kept.bin')
    const gone = project.ship('images/deep/gone.bin')
    const bundle = project.generate('background/service_worker.js')
    const leftover = project.generate('content_scripts/content-0.0a1b2c3d.css')
    const session = createCompiler(project.publicDir, project.outputPath)

    session.finish([kept, gone, bundle, leftover])
    expect(project.inDist(gone.name)).toBe(true)

    project.removeSource(gone.name)
    session.finish([kept, bundle])

    expect(project.inDist(gone.name)).toBe(false)
    expect(project.inDist('images')).toBe(false)
    expect(project.inDist(kept.name)).toBe(true)
    expect(project.inDist(bundle.name)).toBe(true)
    expect(project.inDist(leftover.name)).toBe(true)
  })

  it('removes the old path of a renamed file and keeps the new one', () => {
    const project = createProject()
    const before = project.ship('before.bin')
    const session = createCompiler(project.publicDir, project.outputPath)
    session.finish([before])

    project.removeSource(before.name)
    const after = project.ship('after.bin')
    session.finish([after])

    expect(project.inDist(before.name)).toBe(false)
    expect(project.inDist(after.name)).toBe(true)
  })

  it('keeps a copy whose source is still there, then removes it once the source goes', () => {
    const project = createProject()
    const file = project.ship('still-here.bin')
    const session = createCompiler(project.publicDir, project.outputPath)
    session.finish([file])

    session.finish([])
    expect(project.inDist(file.name)).toBe(true)

    project.removeSource(file.name)
    session.finish([])
    expect(project.inDist(file.name)).toBe(false)
  })

  it('keeps a path the build now emits from somewhere else', () => {
    const project = createProject()
    const file = project.ship('icon.png')
    const session = createCompiler(project.publicDir, project.outputPath)
    session.finish([file])

    project.removeSource(file.name)
    session.finish([{name: file.name}])

    expect(project.inDist(file.name)).toBe(true)
  })

  it('leaves the output alone on a failed compile and prunes on the next good one', () => {
    const project = createProject()
    const file = project.ship('gone-while-broken.bin')
    const session = createCompiler(project.publicDir, project.outputPath)
    session.finish([file])

    project.removeSource(file.name)
    session.finish([], [new Error('broken')])
    expect(project.inDist(file.name)).toBe(true)

    session.finish([])
    expect(project.inDist(file.name)).toBe(false)
  })

  it('still removes the copy when a restart built a new compiler on the same output', () => {
    const project = createProject()
    const file = project.ship('gone-across-restart.bin')
    createCompiler(project.publicDir, project.outputPath).finish([file])

    project.removeSource(file.name)
    createCompiler(project.publicDir, project.outputPath).finish([])

    expect(project.inDist(file.name)).toBe(false)
  })
})
