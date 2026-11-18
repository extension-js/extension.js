import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {makeWriter, readContract, readEvents} from './helpers/contract'

describe('a session contract write that fails', () => {
  let tmp: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'write-failures-'))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  const captureOutput = () => {
    const spies = (['log', 'info', 'warn', 'error'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {})
    )

    return () => spies.flatMap((spy) => spy.mock.calls)
  }

  const compileStart = {
    type: 'compile_start' as const,
    ts: '2026-11-01T00:00:00.000Z',
    command: 'dev' as const,
    browser: 'chromium'
  }

  // Pins today's behavior. Ledger 1383 D5.
  it('leaves no ready.json and prints nothing when the dist is a file', () => {
    fs.writeFileSync(path.join(tmp, 'dist'), 'a file where the folder goes')
    const printed = captureOutput()
    const writer = makeWriter(tmp)

    expect(() => {
      writer.writeStarting()
      writer.appendEvent(compileStart)
      writer.writeCompiled('2026-11-01T00:00:01.000Z')
      writer.writeReady()
      writer.writeError('compile_error', 'Compilation failed')
      writer.stampExecutorAttached()
      writer.stampReload('full')
      writer.settleBrowserLaunch()
      writer.writeShutdown()
    }).not.toThrow()

    expect(fs.existsSync(writer.readyPath)).toBe(false)
    expect(fs.existsSync(writer.eventsPath)).toBe(false)
    expect(fs.readdirSync(tmp)).toEqual(['dist'])
    expect(printed()).toEqual([])
  })

  // Pins today's behavior. Ledger 1383 D5.
  it('loses an event and prints nothing when events.ndjson cannot take it', () => {
    const writer = makeWriter(tmp)
    writer.writeStarting()
    fs.rmSync(writer.eventsPath)
    fs.mkdirSync(writer.eventsPath)
    const printed = captureOutput()

    expect(() => writer.appendEvent(compileStart)).not.toThrow()
    expect(fs.readdirSync(writer.eventsPath)).toEqual([])
    expect(printed()).toEqual([])

    fs.rmdirSync(writer.eventsPath)
    writer.appendEvent({...compileStart, type: 'compile_success'})

    expect(readEvents(writer.eventsPath).map((event) => event.type)).toEqual([
      'compile_success'
    ])
  })

  // Pins today's behavior. Ledger 1383 D5.
  it('opens the run and prints nothing when the old timeline cannot be reset', () => {
    const writer = makeWriter(tmp)
    fs.mkdirSync(writer.eventsPath, {recursive: true})
    const printed = captureOutput()

    expect(() => writer.writeStarting()).not.toThrow()

    expect(readContract(writer.readyPath).status).toBe('starting')
    expect(fs.statSync(writer.eventsPath).isDirectory()).toBe(true)
    expect(printed()).toEqual([])
  })
})
