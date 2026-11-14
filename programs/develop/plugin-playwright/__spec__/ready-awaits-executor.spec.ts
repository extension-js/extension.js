import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {createPlaywrightMetadataWriter, READY_EXECUTOR_WAIT_MS} from '../index'

// An act verb reaches the browser through the extension's background, which
// dials in after the compile. A reader who acted on ready found no executor.
describe('a dev control contract holds ready for the first hello', () => {
  let tmp: string

  beforeEach(() => {
    vi.useFakeTimers()
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ready-awaits-executor-'))
    fs.mkdirSync(path.join(tmp, 'src'), {recursive: true})
    fs.writeFileSync(
      path.join(tmp, 'src', 'manifest.json'),
      JSON.stringify({name: 'Fixture', version: '1.0.0'})
    )
  })

  afterEach(() => {
    vi.useRealTimers()
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  const makeWriter = (
    overrides: Partial<Parameters<typeof createPlaywrightMetadataWriter>[0]>
  ) =>
    createPlaywrightMetadataWriter({
      packageJsonDir: tmp,
      browser: 'chrome',
      command: 'dev',
      distPath: path.join(tmp, 'dist', overrides.browser || 'chrome'),
      manifestPath: path.join(tmp, 'src', 'manifest.json'),
      readyAwaitsExecutor: true,
      ...overrides
    })

  const readyPath = (browser = 'chrome') =>
    path.join(tmp, 'dist', 'extension-js', browser, 'ready.json')

  const readContract = (browser = 'chrome') =>
    JSON.parse(fs.readFileSync(readyPath(browser), 'utf-8')) as Record<
      string,
      unknown
    >

  const patchContract = (
    patch: Record<string, unknown>,
    browser = 'chrome'
  ) => {
    fs.writeFileSync(
      readyPath(browser),
      JSON.stringify({...readContract(browser), ...patch})
    )
  }

  it('keeps the compile at starting, and says what it waits for', () => {
    const writer = makeWriter({})
    writer.writeStarting()
    writer.writeReady('2026-11-01T00:00:00.000Z')

    const ready = readContract()
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

    const ready = readContract()
    expect(ready.status).toBe('ready')
    expect(typeof ready.executorAttachedAt).toBe('string')
    expect(ready.awaitingExecutorSince).toBeUndefined()

    vi.advanceTimersByTime(READY_EXECUTOR_WAIT_MS)
    writer.writeReady('2026-11-01T00:00:05.000Z')
    expect(readContract().status).toBe('ready')
  })

  it('goes ready with no attach stamp once the wait runs out', () => {
    const writer = makeWriter({})
    writer.writeStarting()
    writer.writeReady('2026-11-01T00:00:00.000Z')

    vi.advanceTimersByTime(READY_EXECUTOR_WAIT_MS - 1)
    expect(readContract().status).toBe('starting')

    vi.advanceTimersByTime(1)

    const ready = readContract()
    expect(ready.status).toBe('ready')
    expect(ready.executorAttachedAt).toBeUndefined()
    expect(ready.awaitingExecutorSince).toBeUndefined()

    writer.writeReady('2026-11-01T00:00:20.000Z')
    expect(readContract().status).toBe('ready')
  })

  it('leaves a compile in flight alone when the wait runs out', () => {
    const writer = makeWriter({})
    writer.writeStarting()
    writer.writeReady('2026-11-01T00:00:00.000Z')
    writer.writeStarting()

    vi.advanceTimersByTime(READY_EXECUTOR_WAIT_MS)

    expect(readContract().status).toBe('starting')
    expect(readContract().compiledAt).toBeNull()
  })

  it('does not take a hello from another run as this one', () => {
    const writer = makeWriter({})
    writer.writeStarting()
    patchContract({
      runId: 'an-earlier-run',
      executorAttachedAt: '2026-10-31T00:00:00.000Z'
    })

    writer.writeReady('2026-11-01T00:00:01.000Z')

    expect(readContract().status).toBe('starting')
  })

  it('holds Firefox for both the debugger port and the hello', () => {
    const writer = makeWriter({browser: 'firefox', readyAwaitsRdpPort: true})
    writer.writeStarting()
    writer.writeReady('2026-11-01T00:00:00.000Z')
    expect(readContract('firefox').status).toBe('starting')

    writer.stampExecutorAttached()
    expect(readContract('firefox').status).toBe('starting')

    patchContract({rdpPort: 6006}, 'firefox')
    writer.writeReady('2026-11-01T00:00:01.000Z')
    expect(readContract('firefox').status).toBe('ready')
  })

  it('lets the hello turn Firefox ready when the port came first', () => {
    const writer = makeWriter({browser: 'firefox', readyAwaitsRdpPort: true})
    writer.writeStarting()
    writer.writeReady('2026-11-01T00:00:00.000Z')
    patchContract({rdpPort: 6006}, 'firefox')

    expect(readContract('firefox').status).toBe('starting')

    writer.stampExecutorAttached()
    expect(readContract('firefox').status).toBe('ready')
  })

  it('does not hold a session with no act verbs, a Safari one, or a start receipt', () => {
    makeWriter({readyAwaitsExecutor: false}).writeReady()
    expect(readContract().status).toBe('ready')

    makeWriter({browser: 'safari'}).writeReady()
    expect(readContract('safari').status).toBe('ready')

    fs.rmSync(readyPath(), {force: true})
    makeWriter({command: 'start'}).writeReady()
    expect(readContract().status).toBe('ready')
  })
})
