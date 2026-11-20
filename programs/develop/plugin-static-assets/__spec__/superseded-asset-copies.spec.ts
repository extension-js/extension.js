import * as fs from 'node:fs'
import * as path from 'node:path'
import {type Compiler, rspack, type Stats} from '@rspack/core'
import {afterAll, describe, expect, it} from 'vitest'
import {StaticAssetsPlugin} from '../index'
import {makeFixtureRoot, removeFixtureRoots} from './helpers/compile-harness'
import {pngOfSize} from './helpers/fixtures'

afterAll(() => removeFixtureRoots())

const listAssets = (outputPath: string) =>
  fs.existsSync(path.join(outputPath, 'assets'))
    ? fs.readdirSync(path.join(outputPath, 'assets')).sort()
    : []

// A watch session as dev runs it: the output folder is never cleaned, and
// each rebuild reports through `done` once its files are on disk.
async function watchFixture(
  files: Record<string, string | Buffer>,
  steps: Array<(root: string) => void>
) {
  const root = makeFixtureRoot(files)
  const outputPath = path.join(root, 'dist')
  const compiler: Compiler = rspack({
    context: root,
    mode: 'development',
    entry: {main: './index.js'},
    target: 'webworker',
    devtool: false,
    stats: false,
    infrastructureLogging: {level: 'none'},
    module: {rules: [{test: /\.css$/, type: 'css/auto'}]},
    output: {path: outputPath, publicPath: '/', clean: false},
    plugins: [new StaticAssetsPlugin()]
  })

  const snapshots: string[][] = []
  const errors: string[] = []

  await new Promise<void>((resolve, reject) => {
    let step = 0
    let pending = false
    const watching = compiler.watch(
      {aggregateTimeout: 50, poll: 100},
      (error, stats) => {
        if (error) return reject(error)
        // A rebuild the watcher starts on its own before the edit is not one.
        if (pending) return

        const json = (stats as Stats).toJson({errors: true})
        errors.push(...(json.errors || []).map((e) => e.message))
        snapshots.push(listAssets(outputPath))

        if (step < steps.length) {
          const next = steps[step++]
          pending = true
          // Polled and past the watcher's start time, so the edit is seen.
          setTimeout(() => {
            next(root)
            pending = false
          }, 500)

          return
        }

        watching.close(() => resolve())
      }
    )
  })

  return {snapshots, errors}
}

describe('a dev session rewriting an asset', () => {
  it('keeps only the current hashed copy of a JS import and a CSS url()', async () => {
    const {snapshots, errors} = await watchFixture(
      {
        'photo.png': pngOfSize(5000),
        'bg.png': pngOfSize(6000),
        'style.css': '.a { background: url("./bg.png") }\n',
        'index.js':
          "import photo from './photo.png'\nimport './style.css'\nself.out = {photo}\n"
      },
      [
        (root) => {
          fs.writeFileSync(path.join(root, 'photo.png'), pngOfSize(5001))
          fs.writeFileSync(path.join(root, 'bg.png'), pngOfSize(6001))
        }
      ]
    )

    expect(errors).toEqual([])
    expect(snapshots).toHaveLength(2)

    const pngs = (names: string[]) => names.filter((n) => n.endsWith('.png'))

    expect(pngs(snapshots[0])).toHaveLength(2)
    expect(pngs(snapshots[1])).toHaveLength(2)
    expect(pngs(snapshots[1])).not.toEqual(pngs(snapshots[0]))
  }, 60000)

  it('leaves a file it did not write in the assets folder', async () => {
    const {snapshots} = await watchFixture(
      {
        'photo.png': pngOfSize(5000),
        'dist/assets/kept.txt': 'not ours\n',
        'index.js': "import photo from './photo.png'\nself.out = {photo}\n"
      },
      [
        (root) =>
          fs.writeFileSync(path.join(root, 'photo.png'), pngOfSize(5001))
      ]
    )

    expect(snapshots[1]).toContain('kept.txt')
    expect(snapshots[1].filter((n) => n.endsWith('.png'))).toHaveLength(1)
  }, 60000)
})
