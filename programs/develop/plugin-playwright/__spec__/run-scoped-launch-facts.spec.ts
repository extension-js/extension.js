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
  stampReadyProfileLocked,
  stampReadyStartingUrl,
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
      browserStartId: 'boot-a:1',
      launcherPid: 999_998,
      launcherStartedAt: '2020-01-01T00:00:00.000Z',
      launcherStartId: 'boot-a:2',
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
      'browserStartId',
      'launcherPid',
      'launcherStartedAt',
      'launcherStartId',
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

  // Every fact the launcher stamped on this run outlives a recompile, the
  // ones the writer knows by name and the ones it has never heard of.
  it.each([
    ['binary', '/browsers/chrome-pinned'],
    ['binaryProvenance', 'pinned'],
    ['binaryPinnedBy', '--chromium-binary'],
    ['profileReused', true],
    ['startingUrl', 'https://example.com/'],
    ['startingUrlOpened', false],
    ['startingUrlUnopenedReason', 'no WebDriver session to open it in'],
    ['aLauncherFactNoWriterKnows', 'kept']
  ] as const)('a recompile of the same run keeps %s as %s', (field, kept) => {
    const writer = makeWriter()
    writer.writeReady()

    stampReadyBrowserLaunch(writer.readyPath, {
      binary: '/browsers/chrome-pinned',
      binaryProvenance: 'pinned',
      binaryPinnedBy: '--chromium-binary',
      profileReused: true
    })

    stampReadyStartingUrl(writer.readyPath, {
      startingUrl: 'https://example.com/',
      startingUrlOpened: false,
      startingUrlUnopenedReason: 'no WebDriver session to open it in'
    })

    patchContract(writer.readyPath, {aLauncherFactNoWriterKnows: 'kept'})

    writer.writeReady()

    expect(readContract(writer.readyPath)[field]).toBe(kept)
  })

  it('a recompile never carries the fields the writer computes itself', () => {
    const writer = makeWriter()
    writer.writeError('compile_error', 'Compilation failed', ['boom'])
    patchContract(writer.readyPath, {awaitingExecutorSince: 'stale'})

    writer.writeReady()
    const next = readContract(writer.readyPath)

    expect(next.status).toBe('ready')
    expect(next.errors).toEqual([])
    expect('code' in next).toBe(false)
    expect('message' in next).toBe(false)
    expect('awaitingExecutorSince' in next).toBe(false)
  })
})

// A browser verdict is the launcher's word that nothing is running. A compile
// that succeeds after it says nothing about the browser, so the verdict stands.
describe('a terminal browser verdict outlives a recompile', () => {
  let tmp: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verdicts-'))
  })

  afterEach(() => {
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  it('keeps profile_locked with its evidence', () => {
    const writer = makeProjectWriter(tmp)
    writer.writeReady()

    stampReadyProfileLocked(writer.readyPath, {
      status: 'error',
      code: 'profile_locked',
      message: 'the browser profile is already in use by another session',
      profileLockedAt: '2026-11-01T00:00:00.000Z',
      profileLockOwner: {host: 'devbox', pid: 4242}
    })

    writer.writeReady()
    const next = readContract(writer.readyPath)

    expect(next.status).toBe('error')
    expect(next.code).toBe('profile_locked')
    expect(next.message).toBe(
      'the browser profile is already in use by another session'
    )

    expect(next.profileLockedAt).toBe('2026-11-01T00:00:00.000Z')
    expect(next.profileLockOwner).toEqual({host: 'devbox', pid: 4242})
  })

  it('keeps a verdict code the writer has never heard of', () => {
    const writer = makeProjectWriter(tmp)
    writer.writeReady()

    patchContract(writer.readyPath, {
      status: 'error',
      code: 'a_future_browser_verdict',
      message: 'nothing is running'
    })

    writer.writeReady()
    const next = readContract(writer.readyPath)

    expect(next.status).toBe('error')
    expect(next.code).toBe('a_future_browser_verdict')
  })

  it.each([
    'compile_error',
    'compile_failed'
  ])('clears its own %s verdict once a compile succeeds', (code) => {
    const writer = makeProjectWriter(tmp)
    writer.writeError(code, 'Compilation failed', ['boom'])

    writer.writeReady()
    const next = readContract(writer.readyPath)

    expect(next.status).toBe('ready')
    expect('code' in next).toBe(false)
  })
})
