import * as fs from 'node:fs'
import * as path from 'node:path'
import {type Compiler, rspack} from '@rspack/core'
import {afterEach, describe, expect, it} from 'vitest'
import {trackTempFolders} from '../../__spec__/helpers/temp-folders'

const tempFolder = trackTempFolders()
const closers: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const close of closers.splice(0)) await close()
})

// The first build ends before the watcher of its files is armed. A write in
// that gap is the save a user makes the moment the build line prints.
function buildsAfterWriteInTheGap(target: string, tracked: 'file' | 'missing') {
  const root = fs.realpathSync(tempFolder('extjs-watch-gap-'))
  const late = path.join(root, target)

  fs.writeFileSync(path.join(root, 'index.js'), 'console.log(1)\n')
  if (tracked === 'file') fs.writeFileSync(late, 'first')

  const compiler = rspack({
    context: root,
    mode: 'development',
    entry: './index.js',
    output: {path: path.join(root, 'dist')},
    plugins: [
      {
        apply(tapped: Compiler) {
          tapped.hooks.thisCompilation.tap('tracks-late', (compilation) => {
            if (fs.existsSync(late)) compilation.fileDependencies.add(late)
            else compilation.missingDependencies.add(late)
          })
        }
      }
    ]
  })

  return new Promise<number>((resolve) => {
    let builds = 0
    const timer = setTimeout(() => resolve(builds), 15000)

    compiler.hooks.done.tap('writes-late', () => {
      builds++

      if (builds === 1) {
        fs.mkdirSync(path.dirname(late), {recursive: true})
        fs.writeFileSync(late, 'second')
      }

      if (builds === 2) {
        clearTimeout(timer)
        resolve(builds)
      }
    })

    const watching = compiler.watch({aggregateTimeout: 20}, () => {})

    closers.push(
      () =>
        new Promise<void>((done) => {
          watching.close(() => compiler.close(() => done()))
        })
    )
  })
}

describe('a file written between the first build and the watcher arming', () => {
  it.each([
    ['a file the build read', 'late.txt', 'file'],
    ['a file the build looked for', 'late.txt', 'missing'],
    ['a file in a folder that did not exist', 'img/deep/late.txt', 'missing']
  ] as const)(
    'rebuilds for %s',
    async (_label, target, tracked) => {
      expect(await buildsAfterWriteInTheGap(target, tracked)).toBe(2)
    },
    20000
  )
})
