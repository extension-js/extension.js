import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {runOnlyPreviewBrowser} from '../../run-only'

const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const

// Safari belongs to neither launcher, so the run ends before either is built
// and nothing is spawned, probed or claimed.
describe('a run-only session for a browser no launcher takes', () => {
  let scratch: string
  let listenersBefore: Map<string, unknown[]>

  const counts = () => SIGNALS.map((name) => process.listenerCount(name))

  const run = () =>
    runOnlyPreviewBrowser({
      browser: 'safari',
      outPath: path.join(scratch, 'dist', 'safari'),
      contextDir: scratch,
      extensionsToLoad: []
    }).then(
      () => null,
      (reason: unknown) => reason as Error & {code?: string}
    )

  beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-run-only-none-'))
    listenersBefore = new Map(
      SIGNALS.map((name) => [name, process.listeners(name)])
    )
  })

  afterEach(() => {
    for (const name of SIGNALS) {
      for (const listener of process.listeners(name)) {
        if (!listenersBefore.get(name)?.includes(listener)) {
          process.removeListener(name, listener)
        }
      }
    }

    fs.rmSync(scratch, {recursive: true, force: true})
  })

  it('refuses with E_UNSUPPORTED_BROWSER, names the browser and writes nothing', async () => {
    const error = await run()

    expect(error).toBeInstanceOf(Error)
    expect(error?.message).toBe(
      'Unsupported browser: safari. Pass a Chromium or Firefox family browser to --browser.'
    )

    expect(error?.code).toBe('E_UNSUPPORTED_BROWSER')
    expect(fs.readdirSync(scratch)).toEqual([])
  })

  it('refuses before it adds a signal listener, however often it is asked', async () => {
    const before = counts()

    await run()
    await run()

    expect(counts()).toEqual(before)
  })
})
