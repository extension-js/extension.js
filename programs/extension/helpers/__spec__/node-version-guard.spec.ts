import {afterEach, describe, expect, it, vi} from 'vitest'
import {
  detectBunVersion,
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

  it('names Bun and the --bun flag when the runtime is Bun', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never)

    // Bun 1.2.13 emulates Node 22.6.0, which is what `bunx --bun` reports.
    enforceSupportedNodeVersion('22.6.0', '1.2.13')

    expect(exitSpy).toHaveBeenCalledWith(1)
    const message = errorSpy.mock.calls[0][0] as string
    expect(message).toBe(unsupportedNodeVersionMessage('22.6.0', '1.2.13'))
    expect(message).toBe(
      '[Extension.js] The extension CLI runs on Node.js, not on the Bun ' +
        'runtime. Bun 1.2.13 emulates Node.js 22.6.0, below the required ' +
        '22.12, so the Node.js you have installed is not the problem. ' +
        'Re-run without the --bun flag, plain bunx runs the extension CLI ' +
        'on Node.js.'
    )
    expect(message).not.toContain('Upgrade Node.js')
    expect(message).not.toContain('\n')
  })

  it('keeps the plain Node message when the runtime is not Bun', () => {
    const message = unsupportedNodeVersionMessage('20.19.4')

    expect(message).toBe(
      '[Extension.js] Requires Node.js >= 22.12 (you are on 20.19.4). ' +
        'Upgrade Node.js to run the extension CLI.'
    )
    expect(message).not.toContain('Bun')
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

describe('detectBunRuntime', () => {
  it('reads the Bun version that only the Bun runtime sets', () => {
    const bunVersions = {
      ...process.versions,
      bun: '1.2.13'
    } as unknown as NodeJS.ProcessVersions

    expect(detectBunVersion(bunVersions)).toBe('1.2.13')
  })

  it('reports no Bun on a plain Node process', () => {
    const nodeVersions = {
      node: '24.18.1'
    } as unknown as NodeJS.ProcessVersions

    expect(detectBunVersion(nodeVersions)).toBeUndefined()
    expect(
      detectBunVersion({...nodeVersions, bun: ''} as never)
    ).toBeUndefined()
  })
})
