import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {READY_EXECUTOR_WAIT_MS} from '../index'
import {
  contractPath,
  makeWriter as makeProjectWriter,
  patchContract,
  readContract,
  stampReadyRdpPort,
  type WriterOptions,
  writeManifest
} from './helpers/contract'

// An act verb reaches the browser through the extension's background, which
// dials in after the compile. A reader who acted on ready found no executor.
describe('a dev control contract holds ready for the first hello', () => {
  let tmp: string

  beforeEach(() => {
    vi.useFakeTimers()
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ready-awaits-executor-'))
    writeManifest(path.join(tmp, 'src'), {name: 'Fixture', version: '1.0.0'})
  })

  afterEach(() => {
    vi.useRealTimers()
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  const makeWriter = (overrides: Partial<WriterOptions>) =>
    makeProjectWriter(tmp, {
      browser: 'chrome',
      readyAwaitsExecutor: true,
      ...overrides
    })

  const readyPath = (browser = 'chrome') => contractPath(tmp, browser)

  const contract = (browser = 'chrome') => readContract(readyPath(browser))

  it('keeps the compile at starting, and says what it waits for', () => {
    const writer = makeWriter({})
    writer.writeStarting()
    writer.writeReady('2026-11-01T00:00:00.000Z')

    const ready = contract()
    expect(ready.status).toBe('starting')
    expect(ready.compiledAt).toBe('2026-11-01T00:00:00.000Z')
    expect(typeof ready.awaitingExecutorSince).toBe('string')
    expect(ready.executorAttachedAt).toBeUndefined()
  })

  it('goes ready on the hello, with the attach stamp beside it', () => {
    const writer = makeWriter({})
    writer.writeStarting()
    writer.writeReady('2026-11-01T00:00:00.000Z')

    writer.stampExecutorAttached()

    const ready = contract()
    expect(ready.status).toBe('ready')
    expect(typeof ready.executorAttachedAt).toBe('string')
    expect(ready.awaitingExecutorSince).toBeUndefined()

    vi.advanceTimersByTime(READY_EXECUTOR_WAIT_MS)
    writer.writeReady('2026-11-01T00:00:05.000Z')
    expect(contract().status).toBe('ready')
  })

  it('goes ready with no attach stamp once the wait runs out', () => {
    const writer = makeWriter({})
    writer.writeStarting()
    writer.writeReady('2026-11-01T00:00:00.000Z')

    vi.advanceTimersByTime(READY_EXECUTOR_WAIT_MS - 1)
    expect(contract().status).toBe('starting')

    vi.advanceTimersByTime(1)

    const ready = contract()
    expect(ready.status).toBe('ready')
    expect(ready.executorAttachedAt).toBeUndefined()
    expect(ready.awaitingExecutorSince).toBeUndefined()

    writer.writeReady('2026-11-01T00:00:20.000Z')
    expect(contract().status).toBe('ready')
  })

  it('leaves a compile in flight alone when the wait runs out', () => {
    const writer = makeWriter({})
    writer.writeStarting()
    writer.writeReady('2026-11-01T00:00:00.000Z')
    writer.writeStarting()

    vi.advanceTimersByTime(READY_EXECUTOR_WAIT_MS)

    expect(contract().status).toBe('starting')
    expect(contract().compiledAt).toBeNull()
  })

  it('does not take a hello from another run as this one', () => {
    const writer = makeWriter({})
    writer.writeStarting()
    patchContract(readyPath(), {
      runId: 'an-earlier-run',
      executorAttachedAt: '2026-10-31T00:00:00.000Z'
    })

    writer.writeReady('2026-11-01T00:00:01.000Z')

    expect(contract().status).toBe('starting')
  })

  it('holds Firefox for both the debugger port and the hello', () => {
    const writer = makeWriter({browser: 'firefox', readyAwaitsRdpPort: true})
    writer.writeStarting()
    writer.writeReady('2026-11-01T00:00:00.000Z')
    expect(contract('firefox').status).toBe('starting')

    writer.stampExecutorAttached()
    expect(contract('firefox').status).toBe('starting')

    stampReadyRdpPort(readyPath('firefox'), 6006)
    writer.writeReady('2026-11-01T00:00:01.000Z')
    expect(contract('firefox').status).toBe('ready')
  })

  it('lets the hello turn Firefox ready when the port came first', () => {
    const writer = makeWriter({browser: 'firefox', readyAwaitsRdpPort: true})
    writer.writeStarting()
    writer.writeReady('2026-11-01T00:00:00.000Z')
    stampReadyRdpPort(readyPath('firefox'), 6006)

    expect(contract('firefox').status).toBe('starting')

    writer.stampExecutorAttached()
    expect(contract('firefox').status).toBe('ready')
  })

  it('does not hold a session with no act verbs, a Safari one, or a start receipt', () => {
    makeWriter({readyAwaitsExecutor: false}).writeReady()
    expect(contract().status).toBe('ready')

    makeWriter({browser: 'safari'}).writeReady()
    expect(contract('safari').status).toBe('ready')

    fs.rmSync(readyPath(), {force: true})
    makeWriter({command: 'start'}).writeReady()
    expect(contract().status).toBe('ready')
  })
})
