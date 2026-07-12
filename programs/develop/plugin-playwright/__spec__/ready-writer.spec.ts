import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {describe, it, expect, beforeEach, afterEach} from 'vitest'
import {createPlaywrightMetadataWriter} from '../index'

describe('ready.json writer preservation', () => {
  let tmp: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ready-writer-'))
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

  it('preserves launcher-stamped browserExitedAt/browserExitCode across recompiles', () => {
    const writer = makeWriter()
    writer.writeReady()

    // simulate the chromium launcher stamping a mid-session browser death
    const ready = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    ready.browserExitedAt = '2026-07-12T00:00:00.000Z'
    ready.browserExitCode = 21
    ready.cdpPort = 9223
    fs.writeFileSync(writer.readyPath, JSON.stringify(ready))

    // a later compile succeeding must not erase the death evidence
    writer.writeReady()

    const after = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    expect(after.status).toBe('ready')
    expect(after.browserExitedAt).toBe('2026-07-12T00:00:00.000Z')
    expect(after.browserExitCode).toBe(21)
    expect(after.cdpPort).toBe(9223)
  })

  it('does not invent the fields when the launcher never stamped them', () => {
    const writer = makeWriter()
    writer.writeReady()
    writer.writeReady()

    const after = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    expect('browserExitedAt' in after).toBe(false)
    expect('browserExitCode' in after).toBe(false)
  })
})
