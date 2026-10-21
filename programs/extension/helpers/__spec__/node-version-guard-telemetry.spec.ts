import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {reportUnsupportedRuntime} from '../node-version-guard'
import {Telemetry} from '../telemetry'

const savedTelemetry = process.env.EXTENSION_TELEMETRY
const savedConfigHome = process.env.XDG_CONFIG_HOME
let configHome = ''

beforeEach(() => {
  configHome = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-guard-config-'))
  process.env.XDG_CONFIG_HOME = configHome
})

afterEach(() => {
  vi.restoreAllMocks()

  if (savedTelemetry === undefined) delete process.env.EXTENSION_TELEMETRY
  else process.env.EXTENSION_TELEMETRY = savedTelemetry

  if (savedConfigHome === undefined) delete process.env.XDG_CONFIG_HOME
  else process.env.XDG_CONFIG_HOME = savedConfigHome

  fs.rmSync(configHome, {recursive: true, force: true})
})

function spyOnSend() {
  const track = vi.spyOn(Telemetry.prototype, 'track')
  const flush = vi.spyOn(Telemetry.prototype, 'flushSync').mockReturnValue(true)

  return {track, flush}
}

describe('an unsupported runtime is reported before the guard exits', () => {
  it('sends one coded failure on a machine that agreed to telemetry', () => {
    process.env.EXTENSION_TELEMETRY = '1'
    const {track, flush} = spyOnSend()

    reportUnsupportedRuntime(['node', 'extension', 'dev'])

    expect(track).toHaveBeenCalledTimes(1)
    expect(track.mock.calls[0][0]).toBe('command_failed')
    expect(track.mock.calls[0][1]).toMatchObject({
      command: 'dev',
      success: false,
      code: 'E_NODE_VERSION',
      exit_code: 1
    })

    expect(flush).toHaveBeenCalledTimes(1)
  })

  it('reads a verb it does not know as unknown, never as typed', () => {
    process.env.EXTENSION_TELEMETRY = '1'
    const {track} = spyOnSend()

    reportUnsupportedRuntime(['node', 'extension', './my-private-project'])

    expect(track.mock.calls[0][1]).toMatchObject({command: 'unknown'})
  })

  it('sends nothing before the first-run notice has been shown', () => {
    delete process.env.EXTENSION_TELEMETRY
    const {track, flush} = spyOnSend()

    reportUnsupportedRuntime(['node', 'extension', 'dev'])

    expect(track).not.toHaveBeenCalled()
    expect(flush).not.toHaveBeenCalled()
  })

  it('sends nothing when telemetry is turned off', () => {
    process.env.EXTENSION_TELEMETRY = '0'
    const {track} = spyOnSend()

    reportUnsupportedRuntime(['node', 'extension', 'dev'])

    expect(track).not.toHaveBeenCalled()
  })
})
