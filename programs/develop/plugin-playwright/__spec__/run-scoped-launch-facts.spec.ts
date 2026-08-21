import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {createPlaywrightMetadataWriter} from '../index'

// Every launch fact in the contract describes the browser ONE run launched.
// Carried into the next run they name a process that is gone, and a consumer
// reading a fresh runId alongside a stale `browserPid` cannot tell that apart
// from a live session: it dials a dead pid. Found by a recorder that adopted
// the previous run's Safari and filmed nothing.
describe('launch facts are scoped to the run that produced them', () => {
  let tmp: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'run-scoped-'))
    fs.mkdirSync(path.join(tmp, 'src'), {recursive: true})
    fs.writeFileSync(
      path.join(tmp, 'src', 'manifest.json'),
      JSON.stringify({name: 'Fixture', version: '1.0.0'})
    )
  })

  afterEach(() => {
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  const makeWriter = () =>
    createPlaywrightMetadataWriter({
      packageJsonDir: tmp,
      browser: 'chromium',
      command: 'dev',
      distPath: path.join(tmp, 'dist', 'chromium'),
      manifestPath: path.join(tmp, 'src', 'manifest.json')
    })

  const readyPath = () =>
    path.join(tmp, 'dist', 'extension-js', 'chromium', 'ready.json')

  const readContract = () =>
    JSON.parse(fs.readFileSync(readyPath(), 'utf-8')) as Record<string, unknown>

  const patchContract = (patch: Record<string, unknown>) => {
    const doc = readContract()
    fs.writeFileSync(readyPath(), JSON.stringify({...doc, ...patch}))
  }

  it("drops a previous run's browser facts instead of republishing them", () => {
    const writer = makeWriter()
    writer.writeReady()

    // A previous run that launched a browser, exited, and left its evidence.
    patchContract({
      runId: 'a-run-that-already-ended',
      browserPid: 999_999,
      cdpPort: 9222,
      binary: '/Applications/Gone.app',
      binaryProvenance: 'pinned',
      browserExitedAt: '2020-01-01T00:00:00.000Z'
    })

    writer.writeReady()
    const next = readContract()

    expect(next.runId).not.toBe('a-run-that-already-ended')
    for (const field of [
      'browserPid',
      'cdpPort',
      'binary',
      'binaryProvenance',
      'browserExitedAt'
    ]) {
      expect(next[field]).toBeUndefined()
    }
  })

  it('keeps them across a recompile, which is the same run', () => {
    const writer = makeWriter()
    writer.writeReady()
    const runId = readContract().runId

    // Same runId: this is the launcher's own stamp, mid-session, and the
    // recompile that follows must not erase it.
    patchContract({
      browserPid: 4242,
      cdpPort: 9333,
      binary: '/Applications/Live.app',
      binaryProvenance: 'pinned'
    })

    writer.writeReady()
    const next = readContract()

    expect(next.runId).toBe(runId)
    expect(next.browserPid).toBe(4242)
    expect(next.cdpPort).toBe(9333)
    expect(next.binary).toBe('/Applications/Live.app')
    expect(next.binaryProvenance).toBe('pinned')
  })
})
