import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {createPlaywrightMetadataWriter} from '../index'

const MAX_EVENTS_BYTES = 8 * 1024 * 1024
const MAX_EVENT_BYTES = 64 * 1024

describe('events.ndjson budget and rotation', () => {
  let tmp: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'events-budget-'))
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
})
