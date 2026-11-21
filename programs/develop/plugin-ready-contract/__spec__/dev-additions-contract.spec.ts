import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import type {DevAddition} from '../../lib/dev-additions'
import {
  makeWriter as makeProjectWriter,
  patchContract,
  readContract,
  stampReadyDevBrowserFlag,
  stampReadyDevBrowserPreference,
  writeManifest
} from './helpers/contract'

describe('devAdditions in the ready contract', () => {
  let tmp: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-additions-contract-'))
    writeManifest(path.join(tmp, 'src'), {name: 'Fixture', version: '1.0.0'})
  })

  afterEach(() => {
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  const makeWriter = () => makeProjectWriter(tmp)

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

    expect('devAdditions' in readContract(writer.readyPath)).toBe(false)
  })

  it('writes what the compile recorded', () => {
    const writer = makeWriter()
    writer.writeStarting()
    writer.setDevAdditions([scripting, tabs])
    writer.writeReady()

    expect(readContract(writer.readyPath).devAdditions).toEqual([
      scripting,
      tabs
    ])
  })

  it('keeps the flag the launcher stamped while a recompile replaces the grants', () => {
    const writer = makeWriter()
    writer.writeStarting()
    writer.setDevAdditions([scripting, tabs])
    writer.writeReady()

    stampReadyDevBrowserFlag(writer.readyPath, flag)

    writer.setDevAdditions([scripting])
    writer.writeReady()

    expect(readContract(writer.readyPath).devAdditions).toEqual([
      scripting,
      flag
    ])
  })

  // The preference the launcher wrote into a kept profile is its entry too.
  it('keeps the preference the launcher stamped across a recompile', () => {
    const preference = {
      kind: 'browser_preference',
      value: 'session.restore_on_startup=5',
      applied: true,
      reason: 'the profile outlives the session'
    }
    const writer = makeWriter()
    writer.writeStarting()
    writer.setDevAdditions([scripting, tabs])
    writer.writeReady()

    stampReadyDevBrowserFlag(writer.readyPath, flag)
    stampReadyDevBrowserPreference(writer.readyPath, preference)

    writer.setDevAdditions([scripting])
    writer.writeReady()

    expect(readContract(writer.readyPath).devAdditions).toEqual([
      scripting,
      flag,
      preference
    ])
  })

  it("drops a previous run's flag verdict", () => {
    const first = makeWriter()
    first.writeStarting()
    first.setDevAdditions([scripting])
    first.writeReady()

    patchContract(first.readyPath, {runId: 'an-earlier-run'})
    stampReadyDevBrowserFlag(first.readyPath, flag)

    const second = makeWriter()
    second.writeStarting()
    second.setDevAdditions([scripting])
    second.writeReady()

    expect(readContract(second.readyPath).devAdditions).toEqual([scripting])
  })
})
