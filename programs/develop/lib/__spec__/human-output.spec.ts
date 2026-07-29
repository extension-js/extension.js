import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {humanError, humanLine, humanWarn, isMachineOutput} from '../messaging'

describe('human output sinks', () => {
  const originalOutput = process.env.EXTENSION_OUTPUT
  let log: ReturnType<typeof vi.spyOn>
  let warn: ReturnType<typeof vi.spyOn>
  let error: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    log = vi.spyOn(console, 'log').mockImplementation(() => {})
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    error = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (originalOutput === undefined) delete process.env.EXTENSION_OUTPUT
    else process.env.EXTENSION_OUTPUT = originalOutput
  })

  it('detects machine output from EXTENSION_OUTPUT', () => {
    delete process.env.EXTENSION_OUTPUT
    expect(isMachineOutput()).toBe(false)
    process.env.EXTENSION_OUTPUT = 'pretty'
    expect(isMachineOutput()).toBe(false)
    process.env.EXTENSION_OUTPUT = 'json'
    expect(isMachineOutput()).toBe(true)
    process.env.EXTENSION_OUTPUT = ' NDJSON '
    expect(isMachineOutput()).toBe(true)
  })

  it('routes every level to its console stream in default mode', () => {
    delete process.env.EXTENSION_OUTPUT
    humanLine('a line')
    humanWarn('a warning')
    humanError('a failure')
    expect(log).toHaveBeenCalledWith('a line')
    expect(warn).toHaveBeenCalledWith('a warning')
    expect(error).toHaveBeenCalledWith('a failure')
  })

  it('keeps multi-part arguments intact in default mode', () => {
    delete process.env.EXTENSION_OUTPUT
    humanLine('label:', ['x', 'y'])
    expect(log).toHaveBeenCalledWith('label:', ['x', 'y'])
  })

  it('suppresses log and warn in machine mode', () => {
    for (const mode of ['json', 'ndjson']) {
      process.env.EXTENSION_OUTPUT = mode
      humanLine('a line')
      humanWarn('a warning')
    }
    expect(log).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
  })

  it('still writes error-level lines in machine mode', () => {
    for (const mode of ['json', 'ndjson']) {
      process.env.EXTENSION_OUTPUT = mode
      humanError('a failure')
    }
    expect(error).toHaveBeenCalledTimes(2)
    expect(error).toHaveBeenCalledWith('a failure')
  })
})
