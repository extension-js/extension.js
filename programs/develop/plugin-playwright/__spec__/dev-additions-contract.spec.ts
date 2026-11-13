import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import type {DevAddition} from '../../lib/dev-additions'
import {createPlaywrightMetadataWriter} from '../index'

describe('devAdditions in the ready contract', () => {
  let tmp: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-additions-contract-'))
    fs.mkdirSync(path.join(tmp, 'src'), {recursive: true})
    fs.writeFileSync(
      path.join(tmp, 'src', 'manifest.json'),
      JSON.stringify({name: 'Fixture', version: '1.0.0'})
    )
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

  const readyPath = () =>
    path.join(tmp, 'dist', 'extension-js', 'chromium', 'ready.json')

  const readContract = () =>
    JSON.parse(fs.readFileSync(readyPath(), 'utf-8')) as Record<string, unknown>

  const scripting: DevAddition = {
    kind: 'permission',
    value: 'scripting',
    reason: 'the dev reload injects the rebuilt files'
  }
  const tabs: DevAddition = {
    kind: 'permission',
    value: 'tabs',
    reason: 'the dev reload finds the open tabs'
  }
  const flag = {
    kind: 'browser_flag',
    value: '--silent-debugger-extension-api',
    applied: true,
    reason: 'hides the debugging bar'
  }

  it('leaves the field out until a compile patched a dev manifest', () => {
    const writer = makeWriter()
    writer.writeStarting()
    writer.writeReady()

    expect('devAdditions' in readContract()).toBe(false)
  })

  it('writes what the compile recorded', () => {
    const writer = makeWriter()
    writer.writeStarting()
    writer.setDevAdditions([scripting, tabs])
    writer.writeReady()

    expect(readContract().devAdditions).toEqual([scripting, tabs])
  })

  it('keeps the flag the launcher stamped while a recompile replaces the grants', () => {
    const writer = makeWriter()
    writer.writeStarting()
    writer.setDevAdditions([scripting, tabs])
    writer.writeReady()

    const stamped = readContract()
    fs.writeFileSync(
      readyPath(),
      JSON.stringify({
        ...stamped,
        devAdditions: [...(stamped.devAdditions as unknown[]), flag]
      })
    )

    writer.setDevAdditions([scripting])
    writer.writeReady()

    expect(readContract().devAdditions).toEqual([scripting, flag])
  })

  it("drops a previous run's flag verdict", () => {
    const first = makeWriter()
    first.writeStarting()
    first.setDevAdditions([scripting])
    first.writeReady()

    const stamped = readContract()
    fs.writeFileSync(
      readyPath(),
      JSON.stringify({
        ...stamped,
        runId: 'an-earlier-run',
        devAdditions: [scripting, flag]
      })
    )

    const second = makeWriter()
    second.writeStarting()
    second.setDevAdditions([scripting])
    second.writeReady()

    expect(readContract().devAdditions).toEqual([scripting])
  })
})
