import {afterEach, describe, expect, it, vi} from 'vitest'
import {
  detectBunVersion,
  detectDenoVersion,
  enforceSupportedNodeVersion,
  isSupportedBunVersion,
  isSupportedDenoVersion,
  isSupportedNodeVersion,
  unsupportedBunVersionMessage,
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
    expect(isSupportedNodeVersion('23.11.1')).toBe(true)
    expect(isSupportedNodeVersion('24.1.0')).toBe(true)
  })

  it('never blocks an unparsable version string', () => {
    expect(isSupportedNodeVersion('weird')).toBe(true)
    expect(isSupportedNodeVersion('')).toBe(true)
  })
})

describe('isSupportedBunVersion', () => {
  // Every version below was run against a real build of this CLI. 1.0.35, 1.1.0
  // and 1.1.20 cannot resolve the rspack native binding at all, and 1.1.38
  // reaches it and then dies inside napi.
  it('rejects every release below the 1.2 floor', () => {
    expect(isSupportedBunVersion('1.0.35')).toBe(false)
    expect(isSupportedBunVersion('1.1.0')).toBe(false)
    expect(isSupportedBunVersion('1.1.20')).toBe(false)
    expect(isSupportedBunVersion('1.1.38')).toBe(false)
  })

  it('accepts 1.2 and later', () => {
    expect(isSupportedBunVersion('1.2.0')).toBe(true)
    expect(isSupportedBunVersion('1.2.13')).toBe(true)
    expect(isSupportedBunVersion('1.3.0')).toBe(true)
    expect(isSupportedBunVersion('1.4.2')).toBe(true)
    expect(isSupportedBunVersion('2.0.0')).toBe(true)
  })
})

describe('isSupportedDenoVersion', () => {
  it('rejects every release below the 2.5 floor', () => {
    expect(isSupportedDenoVersion('1.46.3')).toBe(false)
    expect(isSupportedDenoVersion('2.0.6')).toBe(false)
    expect(isSupportedDenoVersion('2.4.9')).toBe(false)
  })

  it('accepts 2.5 and later', () => {
    expect(isSupportedDenoVersion('2.5.0')).toBe(true)
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

describe('enforceSupportedNodeVersion', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  function spies() {
    return {
      errorSpy: vi.spyOn(console, 'error').mockImplementation(() => {}),
      exitSpy: vi
        .spyOn(process, 'exit')
        .mockImplementation(() => undefined as never)
    }
  }

  it('exits 1 with a one-line message on an unsupported Node version', () => {
    const {errorSpy, exitSpy} = spies()

    enforceSupportedNodeVersion('20.19.4')

    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(errorSpy).toHaveBeenCalledTimes(1)
    const message = errorSpy.mock.calls[0][0] as string
    expect(message).toBe(unsupportedNodeVersionMessage('20.19.4'))
    // The literal wording is what a user pastes into a search, so a change
    // to it is a deliberate one, not a side effect of a refactor.
    expect(message).toBe(
      '[Extension.js] Requires Node.js >= 22.12 (you are on 20.19.4). Upgrade Node.js to run the extension CLI.'
    )

    expect(message).toContain('22.12')
    expect(message).toContain('20.19.4')
    expect(message).not.toContain('\n')
  })

  it('is silent on a supported Node version', () => {
    const {errorSpy, exitSpy} = spies()

    enforceSupportedNodeVersion('22.12.0')

    expect(exitSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('runs on Bun at or above the floor', () => {
    const {errorSpy, exitSpy} = spies()

    // Bun 1.2.0 emulates Node 22.6.0, which is BELOW the Node floor, and still
    // runs. The Bun version is what decides, never the Node it reports.
    enforceSupportedNodeVersion('22.6.0', '1.2.0')
    enforceSupportedNodeVersion('26.3.0', '1.4.2')

    expect(exitSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('names Bun, not the Node it emulates, when Bun is too old', () => {
    const {errorSpy, exitSpy} = spies()

    // 1.1.38 also reports Node 22.6.0, so only the Bun number separates it
    // from 1.2.0, which works.
    enforceSupportedNodeVersion('22.6.0', '1.1.38')

    expect(exitSpy).toHaveBeenCalledWith(1)
    const message = errorSpy.mock.calls[0][0] as string
    expect(message).toBe(unsupportedBunVersionMessage('1.1.38'))
    expect(message).toContain('Bun >= 1.2')
    expect(message).toContain('1.1.38')
    expect(message).not.toContain('22.6.0')
    expect(message).not.toContain('\n')
  })

  it('runs on Deno at or above the floor', () => {
    const {errorSpy, exitSpy} = spies()

    enforceSupportedNodeVersion('24.2.0', undefined, '2.5.0')
    enforceSupportedNodeVersion('26.3.0', undefined, '2.9.2')

    expect(exitSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('names Deno, not the Node it emulates, when Deno is too old', () => {
    const {errorSpy, exitSpy} = spies()

    enforceSupportedNodeVersion('20.11.1', undefined, '2.0.6')

    expect(exitSpy).toHaveBeenCalledWith(1)
    const message = errorSpy.mock.calls[0][0] as string
    expect(message).toBe(unsupportedDenoVersionMessage('2.0.6'))
    expect(message).toContain('Deno >= 2.5')
    expect(message).not.toContain('20.11.1')
    expect(message).not.toContain('\n')
  })

  it('refuses Deno 2.8.0, which cannot load node:querystring', () => {
    const {errorSpy, exitSpy} = spies()

    enforceSupportedNodeVersion('24.2.0', undefined, '2.8.0')

    expect(exitSpy).toHaveBeenCalledWith(1)
    const message = errorSpy.mock.calls[0][0] as string
    expect(message).toContain('2.8.0')
    expect(message).toContain('node:querystring')
    expect(message).toContain('2.8.1')
    expect(message).not.toContain('\n')
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
    const nodeVersions = {node: '24.18.1'} as unknown as NodeJS.ProcessVersions

    expect(detectBunVersion(nodeVersions)).toBeUndefined()
    expect(
      detectBunVersion({...nodeVersions, bun: ''} as never)
    ).toBeUndefined()
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
