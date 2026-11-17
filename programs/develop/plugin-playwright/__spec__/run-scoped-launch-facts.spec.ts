import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {
  makeWriter as makeProjectWriter,
  patchContract,
  readContract,
  stampReadyBrowserExited,
  stampReadyBrowserLaunch,
  stampReadyCdpPort,
  writeManifest
} from './helpers/contract'

// Every launch fact in the contract describes the browser ONE run launched.
// Carried into the next run they name a process that is gone, and a consumer
// reading a fresh runId alongside a stale `browserPid` cannot tell that apart
// from a live session: it dials a dead pid. Found by a recorder that adopted
// the previous run's Safari and filmed nothing.
describe('launch facts are scoped to the run that produced them', () => {
  let tmp: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'run-scoped-'))
    writeManifest(path.join(tmp, 'src'), {name: 'Fixture', version: '1.0.0'})
  })

  afterEach(() => {
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  const makeWriter = () => makeProjectWriter(tmp)

  it("drops a previous run's browser facts instead of republishing them", () => {
    const writer = makeWriter()
    writer.writeReady()

    // A previous run that launched a browser, exited, and left its evidence.
    patchContract(writer.readyPath, {runId: 'a-run-that-already-ended'})
    stampReadyBrowserLaunch(writer.readyPath, {
      browserPid: 999_999,
      browserStartedAt: '2020-01-01T00:00:00.000Z',
      launcherPid: 999_998,
      launcherStartedAt: '2020-01-01T00:00:00.000Z',
      binary: '/Applications/Gone.app',
      binaryProvenance: 'pinned'
    })

    stampReadyCdpPort(writer.readyPath, 9222)
    stampReadyBrowserExited(writer.readyPath, {
      browserExitedAt: '2020-01-01T00:00:00.000Z',
      browserExitCode: null,
      browserExitSignal: null
    })

    writer.writeReady()
    const next = readContract(writer.readyPath)

    expect(next.runId).not.toBe('a-run-that-already-ended')

    for (const field of [
      'browserPid',
      'browserStartedAt',
      'launcherPid',
      'launcherStartedAt',
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
    const runId = readContract(writer.readyPath).runId

    // Same runId: this is the launcher's own stamp, mid-session, and the
    // recompile that follows must not erase it.
    stampReadyBrowserLaunch(writer.readyPath, {
      browserPid: 4242,
      binary: '/Applications/Live.app',
      binaryProvenance: 'pinned'
    })

    stampReadyCdpPort(writer.readyPath, 9333)

    writer.writeReady()
    const next = readContract(writer.readyPath)

    expect(next.runId).toBe(runId)
    expect(next.browserPid).toBe(4242)
    expect(next.cdpPort).toBe(9333)
    expect(next.binary).toBe('/Applications/Live.app')
    expect(next.binaryProvenance).toBe('pinned')
  })
})
