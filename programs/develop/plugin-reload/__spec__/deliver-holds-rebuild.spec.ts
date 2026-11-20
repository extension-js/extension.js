import fs from 'node:fs'
import path from 'node:path'
import {type Compiler, rspack} from '@rspack/core'
import {beforeEach, describe, expect, it} from 'vitest'
import {quietBroker} from '../../__spec__/helpers/quiet-broker'
import {trackTempFolders} from '../../__spec__/helpers/temp-folders'
import type {ReloadAckOutcome} from '../../dev-server/control-bridge/contracts'
import {reloadEachBuild} from '../reload-session'

const tempFolder = trackTempFolders()

beforeEach(() => {
  expect.hasAssertions()
})

// The delivery is awaited inside the done hook, and a done hook that is
// still out does not keep the bundler from starting a build. Under a real
// watching compiler the next build has to wait for the browser's answer, or
// it writes the dist the browser is reading for the reload it was just sent.
describe('a save made while a reload is being delivered', () => {
  it('compiles only after the browser answered', async () => {
    const root = tempFolder('extjs-deliver-hold-')
    const entry = path.join(root, 'background.js')
    const longAgo = new Date(Date.now() - 60_000)

    fs.writeFileSync(entry, 'export const a = 1\n')
    // A file written just now reads as a save to a watcher that starts now.
    fs.utimesSync(entry, longAgo, longAgo)

    const log: string[] = []
    let builds = 0
    let answer: ((outcome: ReloadAckOutcome) => void) | undefined
    const broker = quietBroker({
      broadcastReload: () => {
        log.push('reload sent')

        return 1
      },
      awaitReloadAck: () =>
        new Promise<ReloadAckOutcome>((resolve) => {
          answer = resolve
        })
    })
    const probe = {
      apply(compiler: Compiler) {
        compiler.hooks.compile.tap('probe', () => {
          log.push('compile')
        })
      }
    }
    const compiler = rspack({
      mode: 'development',
      context: root,
      devtool: false,
      entry: {'background/service_worker': entry},
      output: {path: path.join(root, 'dist', 'chrome')},
      plugins: [probe]
    })

    reloadEachBuild(compiler, {browser: 'chrome', broker})

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
      await until('the first build', () => builds === 1)

      fs.writeFileSync(entry, 'export const a = 2\n')
      await until('the reload', () => answer !== undefined)

      watching.invalidate()
      await new Promise((resolve) => setTimeout(resolve, 300))
      log.push('browser answered')
      answer?.('acked')

      await until('the next build', () => builds >= 3)

      expect(log.slice(0, 5)).toEqual([
        'compile',
        'compile',
        'reload sent',
        'browser answered',
        'compile'
      ])
    } finally {
      await new Promise<void>((resolve) => watching.close(() => resolve()))
    }
  }, 60_000)
})
