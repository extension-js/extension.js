import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {createPlaywrightMetadataWriter, getSessionRunId} from '../index'

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

    const ready = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    ready.browserExitedAt = '2026-07-12T00:00:00.000Z'
    ready.browserExitCode = 21
    ready.cdpPort = 9223
    fs.writeFileSync(writer.readyPath, JSON.stringify(ready))

    writer.writeReady()

    const after = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    expect(after.status).toBe('ready')
    expect(after.browserExitedAt).toBe('2026-07-12T00:00:00.000Z')
    expect(after.browserExitCode).toBe(21)
    expect(after.cdpPort).toBe(9223)
  })

  it('preserves the launcher-stamped rdpPort across recompiles (§78)', () => {
    const writer = makeWriter()
    writer.writeReady()

    const ready = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    ready.rdpPort = 9224
    fs.writeFileSync(writer.readyPath, JSON.stringify(ready))

    writer.writeReady()

    const after = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    expect(after.rdpPort).toBe(9224)
  })

  it('ready.json runId equals getSessionRunId for the same session (§77)', () => {
    const writer = makeWriter()
    writer.writeReady()

    const ready = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    expect(ready.runId).toBe(getSessionRunId(tmp, 'chromium'))
    // A different browser is a different session identity.
    expect(getSessionRunId(tmp, 'firefox')).not.toBe(ready.runId)
  })

  it('does not invent the fields when the launcher never stamped them', () => {
    const writer = makeWriter()
    writer.writeReady()
    writer.writeReady()

    const after = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    expect('browserExitedAt' in after).toBe(false)
    expect('browserExitCode' in after).toBe(false)
  })

  it('stamps runtime:"attached"/executorAttachedAt once and preserves it across recompiles', () => {
    const writer = makeWriter()
    writer.writeReady()

    writer.stampExecutorAttached()
    const stamped = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    expect(stamped.runtime).toBe('attached')
    expect(typeof stamped.executorAttachedAt).toBe('string')
    const firstStamp = stamped.executorAttachedAt

    writer.writeReady()
    const afterCompile = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    expect(afterCompile.runtime).toBe('attached')
    expect(afterCompile.executorAttachedAt).toBe(firstStamp)

    writer.stampExecutorAttached()
    const afterReattach = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    expect(afterReattach.executorAttachedAt).toBe(firstStamp)
  })

  it('does not invent the runtime signal before the SW attaches', () => {
    const writer = makeWriter()
    writer.writeReady()
    const after = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    expect('runtime' in after).toBe(false)
    expect('executorAttachedAt' in after).toBe(false)
  })

  it('writeShutdown flips status to stopped, keeping session provenance (§66)', () => {
    const writer = makeWriter()
    writer.writeReady()

    const ready = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    ready.cdpPort = 9223
    fs.writeFileSync(writer.readyPath, JSON.stringify(ready))

    writer.writeShutdown()

    const after = JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8'))
    expect(after.status).toBe('stopped')
    expect(after.code).toBe('shutdown')
    expect(after.cdpPort).toBe(9223)
    expect(after.runId).toBe(ready.runId)
  })

  it('writeShutdown is a no-op when no contract was ever written', () => {
    const writer = makeWriter()
    writer.writeShutdown()
    expect(fs.existsSync(writer.readyPath)).toBe(false)
  })

  it('a build writer never rewrites a LIVE dev session contract (§65)', () => {
    const devWriter = makeWriter()
    devWriter.writeReady()
    const ready = JSON.parse(fs.readFileSync(devWriter.readyPath, 'utf-8'))
    ready.pid = process.ppid
    fs.writeFileSync(devWriter.readyPath, JSON.stringify(ready))

    const buildWriter = createPlaywrightMetadataWriter({
      packageJsonDir: tmp,
      browser: 'chromium',
      command: 'build',
      distPath: path.join(tmp, 'dist', 'chromium'),
      manifestPath: path.join(tmp, 'src', 'manifest.json')
    })
    buildWriter.writeStarting()
    buildWriter.writeReady()
    buildWriter.appendEvent({
      type: 'compile_success',
      ts: new Date().toISOString(),
      command: 'build',
      browser: 'chromium'
    })

    const after = JSON.parse(fs.readFileSync(devWriter.readyPath, 'utf-8'))
    expect(after.command).toBe('dev')
    expect(after.pid).toBe(process.ppid)
    expect(after.runId).toBe(ready.runId)
    expect(fs.existsSync(devWriter.eventsPath)).toBe(false)
  })

  it('a build writer takes over a DEAD dev session contract normally (§65)', () => {
    const devWriter = makeWriter()
    devWriter.writeReady()
    const ready = JSON.parse(fs.readFileSync(devWriter.readyPath, 'utf-8'))
    ready.pid = 99999999
    fs.writeFileSync(devWriter.readyPath, JSON.stringify(ready))

    const buildWriter = createPlaywrightMetadataWriter({
      packageJsonDir: tmp,
      browser: 'chromium',
      command: 'build',
      distPath: path.join(tmp, 'dist', 'chromium'),
      manifestPath: path.join(tmp, 'src', 'manifest.json')
    })
    buildWriter.writeStarting()

    const after = JSON.parse(fs.readFileSync(devWriter.readyPath, 'utf-8'))
    expect(after.command).toBe('build')
    expect(after.pid).toBe(process.pid)
  })
})
