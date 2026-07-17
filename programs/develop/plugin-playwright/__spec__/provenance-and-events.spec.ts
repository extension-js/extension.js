import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {describe, it, expect, beforeEach, afterEach} from 'vitest'
import {createPlaywrightMetadataWriter} from '../index'
import developPackageJson from '../../package.json'

describe('ready.json provenance + events.ndjson run attribution (bugs 32/33)', () => {
  let tmp: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ready-provenance-'))
  })

  afterEach(() => {
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  const makeWriter = (command: 'dev' | 'start' | 'preview' | 'build' = 'dev') =>
    createPlaywrightMetadataWriter({
      packageJsonDir: tmp,
      browser: 'chromium',
      command,
      distPath: path.join(tmp, 'dist', 'chromium'),
      manifestPath: path.join(tmp, 'src', 'manifest.json')
    })

  const writeManifest = (manifest: Record<string, unknown>) => {
    fs.mkdirSync(path.join(tmp, 'src'), {recursive: true})
    fs.writeFileSync(
      path.join(tmp, 'src', 'manifest.json'),
      JSON.stringify(manifest)
    )
  }

  it('stamps the real command, toolchain version and extension name/version', () => {
    writeManifest({name: 'Fixture Extension', version: '1.2.3'})
    const writer = makeWriter('build')
    writer.writeReady()

    const ready = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    expect(ready.command).toBe('build')
    expect(ready.toolchainVersion).toBe(developPackageJson.version)
    expect(ready.extensionName).toBe('Fixture Extension')
    expect(ready.extensionVersion).toBe('1.2.3')
  })

  it('omits extension provenance when the manifest is unreadable', () => {
    const writer = makeWriter()
    writer.writeReady()

    const ready = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    expect(ready.toolchainVersion).toBe(developPackageJson.version)
    expect('extensionName' in ready).toBe(false)
    expect('extensionVersion' in ready).toBe(false)
  })

  it('stamps every events.ndjson entry with the run id', () => {
    const writer = makeWriter()
    writer.writeStarting()
    writer.appendEvent({
      type: 'compile_start',
      ts: new Date().toISOString(),
      command: 'dev',
      browser: 'chromium'
    })
    writer.appendEvent({
      type: 'compile_success',
      ts: new Date().toISOString(),
      command: 'dev',
      browser: 'chromium'
    })

    const ready = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    const lines = fs
      .readFileSync(writer.eventsPath, 'utf-8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(lines).toHaveLength(2)
    for (const entry of lines) {
      expect(entry.runId).toBe(ready.runId)
    }
  })

  it('writeStarting resets the timeline to the current run only', () => {
    const writer = makeWriter()
    writer.writeStarting()
    writer.appendEvent({
      type: 'compile_start',
      ts: new Date().toISOString(),
      command: 'dev',
      browser: 'chromium'
    })
    expect(
      fs.readFileSync(writer.eventsPath, 'utf-8').trim().split('\n')
    ).toHaveLength(1)

    // A "new run" in the same process: the file resets instead of appending
    // prior-run entries forever.
    writer.writeStarting()
    expect(fs.readFileSync(writer.eventsPath, 'utf-8')).toBe('')
  })

  it('writers for the same session share one run id', () => {
    const a = makeWriter('dev')
    const b = makeWriter('dev')
    a.writeReady()
    const readyA = JSON.parse(fs.readFileSync(a.readyPath, 'utf-8'))
    b.writeError('compile_error', 'boom')
    const readyB = JSON.parse(fs.readFileSync(b.readyPath, 'utf-8'))
    expect(readyA.runId).toBe(readyB.runId)
  })
})
