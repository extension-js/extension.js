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

  const linesNaming = (calls: unknown[][], file: string) =>
    calls.map((call) => String(call[0])).filter((line) => line.includes(file))

  // A contract that cannot be written leaves --wait and doctor blind, so the
  // first failure says so once, and the writer goes on without throwing.
  it('warns once, naming ready.json, when the dist is a file', () => {
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
    expect(fs.readdirSync(tmp)).toEqual(['dist'])

    const lines = printed().map((call) => String(call[0]))
    const ready = linesNaming(printed(), writer.readyPath)
    expect(ready).toHaveLength(1)
    expect(ready[0]).toContain('Could not write')
    expect(ready[0]).toMatch(/E[A-Z]+/)
    // The events file failed the same way and gets its one line too.
    expect(lines).toHaveLength(2)
  })

  it('warns again only after a write to the same file succeeded', () => {
    const writer = makeWriter(tmp)
    writer.writeStarting()
    fs.rmSync(writer.readyPath)
    fs.mkdirSync(writer.readyPath)
    const printed = captureOutput()

    writer.writeReady()
    writer.writeReady()
    expect(linesNaming(printed(), writer.readyPath)).toHaveLength(1)

    fs.rmdirSync(writer.readyPath)
    writer.writeReady()
    fs.rmSync(writer.readyPath)
    fs.mkdirSync(writer.readyPath)
    writer.writeReady()

    expect(linesNaming(printed(), writer.readyPath)).toHaveLength(2)
    fs.rmdirSync(writer.readyPath)
  })

  it('warns once and loses the event when events.ndjson cannot take it', () => {
    const writer = makeWriter(tmp)
    writer.writeStarting()
    fs.rmSync(writer.eventsPath)
    fs.mkdirSync(writer.eventsPath)
    const printed = captureOutput()

    expect(() => writer.appendEvent(compileStart)).not.toThrow()
    writer.appendEvent(compileStart)
    expect(fs.readdirSync(writer.eventsPath)).toEqual([])
    expect(linesNaming(printed(), writer.eventsPath)).toHaveLength(1)

    fs.rmdirSync(writer.eventsPath)
    writer.appendEvent({...compileStart, type: 'compile_success'})

    expect(readEvents(writer.eventsPath).map((event) => event.type)).toEqual([
      'compile_success'
    ])
  })

  it('opens the run and warns once when the old timeline cannot be reset', () => {
    const writer = makeWriter(tmp)
    fs.mkdirSync(writer.eventsPath, {recursive: true})
    const printed = captureOutput()

    expect(() => writer.writeStarting()).not.toThrow()

    expect(readContract(writer.readyPath).status).toBe('starting')
    expect(fs.statSync(writer.eventsPath).isDirectory()).toBe(true)
    expect(linesNaming(printed(), writer.eventsPath)).toHaveLength(1)
  })
})
