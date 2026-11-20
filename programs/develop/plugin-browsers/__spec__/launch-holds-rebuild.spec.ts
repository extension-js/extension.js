import fs from 'node:fs'
import path from 'node:path'
import {type Compiler, rspack} from '@rspack/core'
import {beforeEach, describe, expect, it} from 'vitest'
import {trackTempFolders} from '../../__spec__/helpers/temp-folders'
import {type BrowserController, BrowsersPlugin} from '../index'

const tempFolder = trackTempFolders()

beforeEach(() => {
  expect.hasAssertions()
})

// The launch is awaited inside the done hook on purpose. Under a real
// watching compiler that is what keeps a save made meanwhile out of the dist
// the browser is reading for the first time.
describe('a save made while the browser is launching', () => {
  it('compiles only after the launcher came back', async () => {
    const root = tempFolder('extjs-launch-hold-')
    const entry = path.join(root, 'a.js')
    const longAgo = new Date(Date.now() - 60_000)
    fs.writeFileSync(entry, 'export const a = 1\n')
    // A file written just now reads as a save to a watcher that starts now.
    fs.utimesSync(entry, longAgo, longAgo)

    const log: string[] = []
    let builds = 0
    let finishLaunch: ((controller: BrowserController) => void) | undefined
    const probe = {
      apply(compiler: Compiler) {
        compiler.hooks.compile.tap('probe', () => {
          log.push('compile')
        })
      }
    }
    const plugin = new BrowsersPlugin({
      launcher: () =>
        new Promise<BrowserController>((resolve) => {
          log.push('launch starts')
          finishLaunch = resolve
        }),
      browserOptions: {browser: 'chrome'}
    })
    const compiler = rspack({
      mode: 'development',
      context: root,
      devtool: false,
      entry: {a: entry},
      output: {path: path.join(root, 'dist', 'chrome')},
      plugins: [probe, plugin]
    })

    const until = async (what: string, met: () => boolean) => {
      const deadline = Date.now() + 20_000

      while (!met()) {
        if (Date.now() > deadline) throw new Error(`Timed out: ${what}`)

        await new Promise((resolve) => setTimeout(resolve, 10))
      }
    }

    const watching = compiler.watch({}, () => {
      builds += 1
    })

    try {
      await until('the launch', () => finishLaunch !== undefined)

      watching.invalidate()
      await new Promise((resolve) => setTimeout(resolve, 300))
      log.push('launch finished')
      finishLaunch?.({enableUnifiedLogging: async () => {}})

      await until('the rebuild', () => builds === 2)

      expect(log.slice(0, 4)).toEqual([
        'compile',
        'launch starts',
        'launch finished',
        'compile'
      ])
    } finally {
      await new Promise<void>((resolve) => watching.close(() => resolve()))
    }
  }, 60_000)
})
