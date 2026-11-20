import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {stampReadyDistExtensionId} from '../index'
import {
  makeWriter as makeProjectWriter,
  patchContract,
  readContract,
  type WriterOptions,
  writeManifest
} from './helpers/contract'

const OLD_TS = '2020-01-01T00:00:00.000Z'

// A reader dates the status by ts (the --wait freshness window, the doctor
// grace), so ts moves when a write changes the status and never for a fact
// stamped beside it. The launcher follows the same rule.
describe('ts dates the status, not the facts beside it', () => {
  let tmp: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'status-clock-'))
    writeManifest(path.join(tmp, 'src'), {name: 'Fixture', version: '1.0.0'})
  })

  afterEach(() => {
    vi.useRealTimers()
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  const makeWriter = (overrides: Partial<WriterOptions> = {}) =>
    makeProjectWriter(tmp, overrides)

  const readyWriter = () => {
    const writer = makeWriter()
    writer.writeReady()
    patchContract(writer.readyPath, {ts: OLD_TS})

    return writer
  }

  it('a reload stamp leaves ts', () => {
    const writer = readyWriter()
    writer.stampReload('full', 'full reload')

    const after = readContract(writer.readyPath)
    expect(after.reloadKind).toBe('full')
    expect(after.ts).toBe(OLD_TS)
  })

  it('an attach on a ready record leaves ts, and so does a second attach', () => {
    const writer = readyWriter()
    writer.stampExecutorAttached()
    writer.stampExecutorAttached({origin: 'safari-web-extension://ABCDEF12/'})

    const after = readContract(writer.readyPath)
    expect(after.runtime).toBe('attached')
    expect(after.extensionBaseUrl).toBe('safari-web-extension://ABCDEF12/')
    expect(after.ts).toBe(OLD_TS)
  })

  it('a detach leaves ts', () => {
    const writer = readyWriter()
    writer.stampExecutorAttached()
    writer.stampExecutorDetached()

    const after = readContract(writer.readyPath)
    expect(after.runtime).toBe('detached')
    expect(after.ts).toBe(OLD_TS)
  })

  it('the dist extension id stamp leaves ts', () => {
    const writer = readyWriter()
    const distPath = path.join(tmp, 'dist', 'chromium')
    writeManifest(distPath, {name: 'Fixture', version: '1.0.0'})

    stampReadyDistExtensionId(tmp, 'chromium', distPath)

    const after = readContract(writer.readyPath)
    expect(after.extensionIdSource).toBe('derived')
    expect(after.ts).toBe(OLD_TS)
  })

  it('an attach that clears a load refusal turns the record ready and moves ts', () => {
    const writer = readyWriter()
    patchContract(writer.readyPath, {
      status: 'error',
      code: 'extension_load_refused',
      message: 'refused',
      extensionLoadRefusedAt: OLD_TS
    })

    writer.stampExecutorAttached()

    const after = readContract(writer.readyPath)
    expect(after.status).toBe('ready')
    expect(after.ts).not.toBe(OLD_TS)
  })

  it('a shutdown moves ts', () => {
    const writer = readyWriter()
    writer.writeShutdown()

    const after = readContract(writer.readyPath)
    expect(after.status).toBe('stopped')
    expect(after.ts).not.toBe(OLD_TS)
  })
})

describe('a writer at the end of its session', () => {
  let tmp: string

  beforeEach(() => {
    vi.useFakeTimers()
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'writer-teardown-'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  it.each([
    [
      'writeShutdown',
      (w: ReturnType<typeof makeProjectWriter>) => w.writeShutdown()
    ],
    [
      'writeEndedAsFailed',
      (w: ReturnType<typeof makeProjectWriter>) =>
        w.writeEndedAsFailed('E_TEST', 'the session failed')
    ]
  ] as const)('%s stops the wait for the first hello', (_name, end) => {
    const writer = makeProjectWriter(tmp, {
      browser: 'chrome',
      readyAwaitsExecutor: true
    })
    writer.writeReady()
    expect(vi.getTimerCount()).toBe(1)

    end(writer)
    const ended = fs.readFileSync(writer.readyPath, 'utf-8')

    expect(vi.getTimerCount()).toBe(0)
    vi.runAllTimers()
    expect(fs.readFileSync(writer.readyPath, 'utf-8')).toBe(ended)
  })
})

describe('the notice about a live dev session owning a build target', () => {
  let tmp: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'foreign-notice-'))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.EXTENSION_OUTPUT
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  function liveDevSession() {
    const readyPath = path.join(
      tmp,
      'dist',
      'extension-js',
      'chromium',
      'ready.json'
    )
    fs.mkdirSync(path.dirname(readyPath), {recursive: true})
    fs.writeFileSync(
      readyPath,
      JSON.stringify({
        command: 'dev',
        status: 'ready',
        pid: process.ppid,
        runId: 'a-live-dev-run'
      })
    )
  }

  // It comes from the message catalog, so it carries the channel prefix and
  // stays off a stdout that machine output owns.
  it('prints with the warning prefix and keeps quiet under machine output', () => {
    liveDevSession()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    makeProjectWriter(tmp, {command: 'build'})
    const human = warn.mock.calls.map((call) => String(call[0]))
    expect(human).toHaveLength(1)
    expect(human[0]).not.toMatch(/^\[extension\]/)
    expect(human[0]).toContain(`PID ${process.ppid}`)

    warn.mockClear()
    process.env.EXTENSION_OUTPUT = 'json'
    makeProjectWriter(tmp, {command: 'build'})
    expect(warn).not.toHaveBeenCalled()
  })
})
