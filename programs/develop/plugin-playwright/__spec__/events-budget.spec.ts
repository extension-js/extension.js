import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {makeWriter as makeProjectWriter} from './helpers/contract'

const MAX_EVENTS_BYTES = 8 * 1024 * 1024
const MAX_EVENT_BYTES = 64 * 1024

describe('events.ndjson budget and rotation', () => {
  let tmp: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'events-budget-'))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  const makeWriter = () => makeProjectWriter(tmp)

  const failingCompile = (errorBytes: number) => ({
    type: 'compile_error' as const,
    ts: new Date().toISOString(),
    command: 'dev' as const,
    browser: 'chromium',
    errorCount: 1,
    errors: ['E'.repeat(errorBytes)]
  })

  const lines = (filePath: string) =>
    fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean)

  it('caps a single oversized event and keeps the row parseable', () => {
    const writer = makeWriter()

    writer.appendEvent(failingCompile(5 * 1024 * 1024))

    const written = lines(writer.eventsPath)
    expect(written).toHaveLength(1)
    expect(Buffer.byteLength(written[0])).toBeLessThanOrEqual(MAX_EVENT_BYTES)

    const row = JSON.parse(written[0])
    expect(row.type).toBe('compile_error')
    expect(row.truncated).toBe(true)
    expect(typeof row.errors[0]).toBe('string')
  })

  it('rotates instead of growing past the byte budget', () => {
    const writer = makeWriter()

    for (let n = 0; n < 300; n++) {
      writer.appendEvent(failingCompile(1024 * 1024))
    }

    const rotated = writer.eventsPath.replace(/\.ndjson$/, '.1.ndjson')
    expect(fs.existsSync(rotated)).toBe(true)
    expect(fs.statSync(writer.eventsPath).size).toBeLessThan(MAX_EVENTS_BYTES)
    expect(fs.statSync(rotated).size).toBeLessThan(
      MAX_EVENTS_BYTES + MAX_EVENT_BYTES
    )

    for (const line of lines(writer.eventsPath)) {
      expect(() => JSON.parse(line)).not.toThrow()
    }
  })

  it('leaves an event inside the cap untouched', () => {
    const writer = makeWriter()

    writer.appendEvent(failingCompile(64))

    const row = JSON.parse(lines(writer.eventsPath)[0])
    expect(row.errors[0]).toBe('E'.repeat(64))
    expect('truncated' in row).toBe(false)
  })

  // Pins today's behavior. Ledger 1383.
  it('drops every error when trimming each one still leaves the row over the cap', () => {
    const writer = makeWriter()

    writer.appendEvent({
      ...failingCompile(0),
      errorCount: 40_000,
      errors: Array.from({length: 40_000}, () => 'E')
    })

    const row = JSON.parse(lines(writer.eventsPath)[0])
    expect(row.errors).toEqual([])
    expect(row.errorCount).toBe(40_000)
    expect(row.truncated).toBe(true)
  })

  // Pins today's behavior. Ledger 1383.
  it('writes a row over the cap when the oversize is not in the errors', () => {
    const writer = makeWriter()

    writer.appendEvent({
      type: 'browser_launch_failed',
      ts: new Date().toISOString(),
      command: 'dev',
      browser: 'chromium',
      reason: 'R'.repeat(2 * MAX_EVENT_BYTES)
    })

    const written = lines(writer.eventsPath)
    const row = JSON.parse(written[0])
    expect(Buffer.byteLength(written[0])).toBeGreaterThan(MAX_EVENT_BYTES)
    expect(row.reason).toHaveLength(2 * MAX_EVENT_BYTES)
    expect(row.errors).toEqual([])
    expect(row.truncated).toBe(true)
  })

  // Pins today's behavior. Ledger 1383 D5.
  it('resets the budget after a rotation that failed, so the file grows past it', () => {
    const writer = makeWriter()
    const oldest = writer.eventsPath.replace(/\.ndjson$/, '.3.ndjson')
    const rotated = writer.eventsPath.replace(/\.ndjson$/, '.1.ndjson')
    const output = (['log', 'warn', 'error'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {})
    )

    // A folder where the oldest generation goes makes the rotation throw.
    fs.mkdirSync(oldest, {recursive: true})

    while (
      !fs.existsSync(writer.eventsPath) ||
      fs.statSync(writer.eventsPath).size < MAX_EVENTS_BYTES
    ) {
      writer.appendEvent(failingCompile(1024 * 1024))
    }

    expect(fs.existsSync(rotated)).toBe(false)

    fs.rmSync(oldest, {recursive: true})
    writer.appendEvent(failingCompile(64))

    expect(fs.existsSync(rotated)).toBe(false)
    expect(fs.statSync(writer.eventsPath).size).toBeGreaterThan(
      MAX_EVENTS_BYTES
    )

    expect(output.flatMap((spy) => spy.mock.calls)).toEqual([])
  })
})
