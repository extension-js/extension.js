import {afterEach, describe, expect, it, vi} from 'vitest'
import {
  detectBunVersion,
  detectDenoVersion,
  enforceSupportedNodeVersion,
  isSupportedDenoVersion,
  isSupportedNodeVersion,
  unsupportedDenoVersionMessage,
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

  it('names Bun and every way of landing on it when the runtime is Bun', () => {
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
        'runtime (Bun 1.2.13, reporting Node.js 22.6.0), so the Node.js ' +
        'you have installed is not the problem. Run it on Node.js instead: ' +
        'drop --bun from bunx or bun run, or unset run.bun in bunfig.toml, ' +
        'plain bunx runs the extension CLI on Node.js.'
    )

    expect(message).toContain('bunx')
    expect(message).toContain('bun run')
    expect(message).toContain('run.bun')
    expect(message).not.toContain('Upgrade Node.js')
    expect(message).not.toContain('\n')
  })

  it('refuses Bun even when its emulated Node version clears the floor', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never)

    enforceSupportedNodeVersion('22.12.0', '1.3.0')
    enforceSupportedNodeVersion('24.1.0', '1.3.0')

    expect(exitSpy).toHaveBeenCalledTimes(2)
    expect(exitSpy).toHaveBeenCalledWith(1)

    for (const call of errorSpy.mock.calls) {
      const message = call[0] as string
      expect(message).toBe(
        unsupportedNodeVersionMessage(
          message.includes('24.1.0') ? '24.1.0' : '22.12.0',
          '1.3.0'
        )
      )

      expect(message).toContain('Bun 1.3.0')
      expect(message).not.toContain('\n')
    }
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

  it('runs on Deno at or above the floor', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never)

    // Deno 2.5 emulates Node 24.2.0 and 2.9 emulates 26.3.0, both measured.
    enforceSupportedNodeVersion('24.2.0', undefined, '2.5.0')
    enforceSupportedNodeVersion('26.3.0', undefined, '2.9.2')

    expect(exitSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('names Deno, not the Node it emulates, when Deno is too old', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never)

    // Deno 2.0.6 emulates Node 20.11.1, which would otherwise send the user
    // to upgrade a Node install that is not what the CLI is running on.
    enforceSupportedNodeVersion('20.11.1', undefined, '2.0.6')

    expect(exitSpy).toHaveBeenCalledWith(1)
    const message = errorSpy.mock.calls[0][0] as string
    expect(message).toBe(unsupportedDenoVersionMessage('2.0.6'))
    expect(message).toContain('Deno >= 2.5')
    expect(message).toContain('2.0.6')
    expect(message).not.toContain('20.11.1')
    expect(message).not.toContain('\n')
  })

  it('refuses Deno 2.8.0, which cannot load node:querystring', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never)

    enforceSupportedNodeVersion('24.2.0', undefined, '2.8.0')

    expect(exitSpy).toHaveBeenCalledWith(1)
    const message = errorSpy.mock.calls[0][0] as string
    expect(message).toContain('2.8.0')
    expect(message).toContain('node:querystring')
    expect(message).toContain('2.8.1')
    expect(message).not.toContain('\n')
  })
})

describe('isSupportedDenoVersion', () => {
  it('rejects every release below the 2.5 floor', () => {
    expect(isSupportedDenoVersion('1.46.3')).toBe(false)
    expect(isSupportedDenoVersion('2.0.6')).toBe(false)
    expect(isSupportedDenoVersion('2.4.9')).toBe(false)
  })

  // Each of these was run against a real build of this CLI before being listed.
  it('accepts 2.5 and later', () => {
    expect(isSupportedDenoVersion('2.5.0')).toBe(true)
    expect(isSupportedDenoVersion('2.6.0')).toBe(true)
    expect(isSupportedDenoVersion('2.7.2')).toBe(true)
    expect(isSupportedDenoVersion('2.9.2')).toBe(true)
    expect(isSupportedDenoVersion('3.0.0')).toBe(true)
  })

  it('rejects 2.8.0 alone, and takes 2.8.1 back', () => {
    expect(isSupportedDenoVersion('2.8.0')).toBe(false)
    expect(isSupportedDenoVersion('2.8.1')).toBe(true)
    expect(isSupportedDenoVersion('2.8.3')).toBe(true)
  })
})

describe('detectDenoVersion', () => {
  it('reads the Deno version that only the Deno runtime sets', () => {
    const denoVersions = {
      ...process.versions,
      deno: '2.9.2'
    } as unknown as NodeJS.ProcessVersions

    expect(detectDenoVersion(denoVersions)).toBe('2.9.2')
  })

  it('reports no Deno on a plain Node process', () => {
    const nodeVersions = {node: '24.18.1'} as unknown as NodeJS.ProcessVersions

    expect(detectDenoVersion(nodeVersions)).toBeUndefined()
    expect(
      detectDenoVersion({...nodeVersions, deno: ''} as never)
    ).toBeUndefined()
  })
})

describe('detectBunVersion', () => {
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
