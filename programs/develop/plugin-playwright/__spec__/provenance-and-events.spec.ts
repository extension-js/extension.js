import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import developPackageJson from '../../package.json'
import type {PlaywrightAutomationCommand} from '../index'
import {
  makeWriter as makeProjectWriter,
  patchContract,
  readContract,
  readEvents,
  writeManifest as writeManifestIn
} from './helpers/contract'

describe('ready.json provenance + events.ndjson run attribution (bugs 32/33)', () => {
  let tmp: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ready-provenance-'))
  })

  afterEach(() => {
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  const makeWriter = (command: PlaywrightAutomationCommand = 'dev') =>
    makeProjectWriter(tmp, {command})

  const writeManifest = (manifest: Record<string, unknown>) =>
    writeManifestIn(path.join(tmp, 'src'), manifest)

  const writeDistManifest = (manifest: Record<string, unknown>) =>
    writeManifestIn(path.join(tmp, 'dist', 'chromium'), manifest)

  it('stamps the real command, toolchain version and extension name/version', () => {
    writeManifest({name: 'Fixture Extension', version: '1.2.3'})
    const writer = makeWriter('build')
    writer.writeReady()

    const ready = readContract(writer.readyPath)
    expect(ready.command).toBe('build')
    expect(ready.toolchainVersion).toBe(developPackageJson.version)
    expect(ready.extensionName).toBe('Fixture Extension')
    expect(ready.extensionVersion).toBe('1.2.3')
  })

  it('a build names the manifest it compiles, not the dist of the previous build', () => {
    writeDistManifest({name: 'Old Name', version: '0.1.0'})
    writeManifest({name: 'New Name', version: '0.2.0'})
    const writer = makeWriter('build')
    writer.writeReady()

    const ready = readContract(writer.readyPath)
    expect(ready.extensionName).toBe('New Name')
    expect(ready.extensionVersion).toBe('0.2.0')
  })

  it('a dev session names the dist the browser loaded, stale or not', () => {
    writeDistManifest({name: 'Old Name', version: '0.1.0'})
    writeManifest({name: 'New Name', version: '0.2.0'})
    const writer = makeWriter('dev')
    writer.writeReady()

    const ready = readContract(writer.readyPath)
    expect(ready.extensionName).toBe('Old Name')
    expect(ready.extensionVersion).toBe('0.1.0')
  })

  it('a build falls back to the dist when the source manifest is unreadable', () => {
    writeDistManifest({name: 'Dist Only', version: '0.1.0'})
    const writer = makeWriter('build')
    writer.writeReady()

    const ready = readContract(writer.readyPath)
    expect(ready.extensionName).toBe('Dist Only')
    expect(ready.extensionVersion).toBe('0.1.0')
  })

  it('omits extension provenance when the manifest is unreadable', () => {
    const writer = makeWriter()
    writer.writeReady()

    const ready = readContract(writer.readyPath)
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

    const ready = readContract(writer.readyPath)
    const lines = readEvents(writer.eventsPath)
    expect(lines).toHaveLength(2)

    for (const entry of lines) {
      expect(entry.runId).toBe(ready.runId)
    }
  })

  it('writeStarting resets the timeline only when the run on disk is another', () => {
    const writer = makeWriter()
    writer.writeStarting()
    writer.appendEvent({
      type: 'compile_start',
      ts: new Date().toISOString(),
      command: 'dev',
      browser: 'chromium'
    })

    expect(readEvents(writer.eventsPath)).toHaveLength(1)

    makeWriter().writeStarting()
    expect(readEvents(writer.eventsPath)).toHaveLength(1)

    patchContract(writer.readyPath, {runId: 'an-earlier-run'})

    makeWriter().writeStarting()
    expect(fs.readFileSync(writer.eventsPath, 'utf-8')).toBe('')
  })

  it('writers for the same session share one run id', () => {
    const a = makeWriter('dev')
    const b = makeWriter('dev')
    a.writeReady()
    const readyA = readContract(a.readyPath)
    b.writeError('compile_error', 'boom')
    const readyB = readContract(b.readyPath)
    expect(readyA.runId).toBe(readyB.runId)
  })
})
