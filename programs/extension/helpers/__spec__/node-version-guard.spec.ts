import {afterEach, describe, expect, it, vi} from 'vitest'
import {
  enforceSupportedNodeVersion,
  isSupportedNodeVersion,
  unsupportedNodeVersionMessage
} from '../node-version-guard'

describe('isSupportedNodeVersion', () => {
  it('rejects majors below 22', () => {
    expect(isSupportedNodeVersion('18.20.8')).toBe(false)
    expect(isSupportedNodeVersion('20.19.4')).toBe(false)
  })

  it('rejects 22.0 through 22.11 (require(esm) landed in 22.12)', () => {
    expect(isSupportedNodeVersion('22.0.0')).toBe(false)
    expect(isSupportedNodeVersion('22.11.9')).toBe(false)
  })

  it('accepts 22.12 and later', () => {
    expect(isSupportedNodeVersion('22.12.0')).toBe(true)
    expect(isSupportedNodeVersion('22.16.0')).toBe(true)
    expect(isSupportedNodeVersion('23.0.0')).toBe(true)
    expect(isSupportedNodeVersion('24.1.0')).toBe(true)
  })

  it('never blocks an unparsable version string', () => {
    expect(isSupportedNodeVersion('weird')).toBe(true)
    expect(isSupportedNodeVersion('')).toBe(true)
  })
})

describe('enforceSupportedNodeVersion', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('exits 1 with a one-line message on an unsupported version', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never)

    enforceSupportedNodeVersion('20.19.4')

    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(errorSpy).toHaveBeenCalledTimes(1)
    const message = errorSpy.mock.calls[0][0] as string
    expect(message).toBe(unsupportedNodeVersionMessage('20.19.4'))
    expect(message).toContain('22.12')
    expect(message).toContain('20.19.4')
    expect(message).not.toContain('\n')
  })

  it('is silent on a supported version', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never)

    enforceSupportedNodeVersion('22.12.0')

    expect(exitSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
  })
})
