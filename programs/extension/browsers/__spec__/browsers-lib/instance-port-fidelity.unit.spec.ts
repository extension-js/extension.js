import {beforeEach, describe, expect, it} from 'vitest'
import {
  AmbiguousInstanceError,
  getInstancePorts,
  getLastCDPPort,
  getLastRDPPort,
  resolvePortForInstance,
  setInstancePorts
} from '../../browsers-lib/instance-registry'
import {deriveDebugPortWithInstance} from '../../browsers-lib/shared-utils'
import {RemoteFirefox} from '../../run-firefox/rdp/remote-firefox'

const CHROME_CDP = 9222
const EDGE_CDP = 9333
const CHROME_RDP = 6000
const EDGE_RDP = 6111

beforeEach(() => {
  setInstancePorts('chrome-instance', {
    cdpPort: CHROME_CDP,
    rdpPort: CHROME_RDP
  })

  setInstancePorts('edge-instance', {cdpPort: EDGE_CDP, rdpPort: EDGE_RDP})
})

describe('resolvePortForInstance, the one shared contract', () => {
  it('faithful: a known instance resolves to its OWN registered port (cdp + rdp)', () => {
    expect(resolvePortForInstance('chrome-instance', 'cdp')).toBe(CHROME_CDP)
    expect(resolvePortForInstance('edge-instance', 'cdp')).toBe(EDGE_CDP)
    expect(resolvePortForInstance('chrome-instance', 'rdp')).toBe(CHROME_RDP)
    expect(resolvePortForInstance('edge-instance', 'rdp')).toBe(EDGE_RDP)
  })

  it('does NOT cross streams: chrome never resolves to the last-launched edge port', () => {
    expect(resolvePortForInstance('chrome-instance', 'cdp')).not.toBe(EDGE_CDP)
    expect(resolvePortForInstance('chrome-instance', 'rdp')).not.toBe(EDGE_RDP)
  })

  it('cannot-tell: a missing instance id with no fallback THROWS instead of guessing', () => {
    expect(() => resolvePortForInstance(undefined, 'cdp')).toThrow(
      AmbiguousInstanceError
    )

    expect(() => resolvePortForInstance(undefined, 'rdp')).toThrow(
      AmbiguousInstanceError
    )
  })

  it('cannot-tell error names the protocol and never leaks a port value', () => {
    try {
      resolvePortForInstance(undefined, 'cdp')

      throw new Error('expected AmbiguousInstanceError')
    } catch (error) {
      expect(error).toBeInstanceOf(AmbiguousInstanceError)
      const err = error as AmbiguousInstanceError
      expect(err.protocol).toBe('cdp')
      expect(err.instanceId).toBeUndefined()
      expect(err.message).not.toContain(String(EDGE_CDP))
    }
  })

  it('cannot-tell error carries the code the table maps its name onto', () => {
    expect(() => resolvePortForInstance(undefined, 'rdp')).toThrow(
      expect.objectContaining({
        name: 'AmbiguousInstanceError',
        code: 'E_INSTANCE_AMBIGUOUS'
      })
    )
  })

  it('known-but-unregistered instance defers to the caller fallback, never another instance port', () => {
    const myDefault = 9555
    expect(resolvePortForInstance('not-yet-registered', 'cdp', myDefault)).toBe(
      myDefault
    )

    expect(resolvePortForInstance('not-yet-registered', 'cdp')).toBeUndefined()
  })

  it('a caller-supplied fallback is honored for the cannot-tell case (no throw)', () => {
    expect(resolvePortForInstance(undefined, 'cdp', 9999)).toBe(9999)
  })

  it('the process-wide last-launched telemetry is NOT a resolution path', () => {
    expect(getLastCDPPort()).toBe(EDGE_CDP)
    expect(getLastRDPPort()).toBe(EDGE_RDP)
    expect(resolvePortForInstance('chrome-instance', 'cdp')).toBe(CHROME_CDP)
  })
})

describe('firefox RemoteFirefox.resolveRdpPort, faithful per-instance RDP resolution', () => {
  const callResolve = (
    instanceId: string | undefined,
    port: number
  ): number => {
    const inst = new RemoteFirefox({
      browser: 'firefox',
      instanceId,
      port,
      extension: []
    } as unknown as ConstructorParameters<typeof RemoteFirefox>[0])

    return (inst as unknown as {resolveRdpPort: () => number}).resolveRdpPort()
  }

  it('faithful: firefox tooling for an instance reaches that instance RDP port', () => {
    expect(callResolve('chrome-instance', 5000)).toBe(CHROME_RDP)
    expect(callResolve('edge-instance', 5000)).toBe(EDGE_RDP)
  })

  it('today-cross-talk case is fixed: firefox does not fall back to the last RDP port', () => {
    const derived = deriveDebugPortWithInstance(5000, 'ff-unregistered')
    expect(callResolve('ff-unregistered', 5000)).toBe(derived)
    expect(callResolve('ff-unregistered', 5000)).not.toBe(EDGE_RDP)
  })

  it('cannot-tell: with no instance id, firefox uses its own derived port, NOT last-launched edge', () => {
    const derived = deriveDebugPortWithInstance(5000, undefined)
    expect(callResolve(undefined, 5000)).toBe(derived)
    expect(callResolve(undefined, 5000)).not.toBe(EDGE_RDP)
  })

  it('single-browser run is unchanged: the registered instance port is returned', () => {
    expect(callResolve('chrome-instance', 5000)).toBe(CHROME_RDP)
  })

  const callResolvePinned = (
    instanceId: string | undefined,
    resolvedRdpPort: number,
    port?: number
  ): number => {
    const inst = new RemoteFirefox({
      browser: 'firefox',
      instanceId,
      port,
      resolvedRdpPort,
      extension: []
    } as unknown as ConstructorParameters<typeof RemoteFirefox>[0])

    return (inst as unknown as {resolveRdpPort: () => number}).resolveRdpPort()
  }

  it('pinned: a concrete launched port with no instance id is used verbatim, NOT re-derived', () => {
    expect(callResolvePinned(undefined, 9230)).toBe(9230)
    expect(callResolvePinned(undefined, 9230)).not.toBe(
      deriveDebugPortWithInstance(9230, undefined)
    )
  })

  it('pinned: a concrete launched port is honored even when `port` is also a base value', () => {
    expect(callResolvePinned(undefined, 9230, 5000)).toBe(9230)
  })

  it('pinned: a registered instance still overrides (per-instance faithfulness preserved)', () => {
    expect(callResolvePinned('chrome-instance', 9230)).toBe(CHROME_RDP)
  })
})

describe('instance port registry', () => {
  beforeEach(() => {
    setInstancePorts('reset-a', {cdpPort: 1, rdpPort: 2})
  })

  it('returns undefined for an unknown or missing instance id', () => {
    expect(getInstancePorts('never-set')).toBeUndefined()
    expect(getInstancePorts(undefined)).toBeUndefined()
  })

  it('stores and retrieves ports per instance id', () => {
    setInstancePorts('inst-1', {cdpPort: 9222})
    expect(getInstancePorts('inst-1')).toEqual({cdpPort: 9222})
  })

  it('merges partial updates rather than replacing the record', () => {
    setInstancePorts('inst-2', {cdpPort: 9333})
    setInstancePorts('inst-2', {rdpPort: 6000})
    expect(getInstancePorts('inst-2')).toEqual({cdpPort: 9333, rdpPort: 6000})
  })

  it('tracks the last-seen CDP and RDP ports globally', () => {
    setInstancePorts('inst-3', {cdpPort: 9444})
    setInstancePorts(undefined, {rdpPort: 6111})
    expect(getLastCDPPort()).toBe(9444)
    expect(getLastRDPPort()).toBe(6111)
  })

  it('does not throw when given no instance id but valid ports', () => {
    expect(() => setInstancePorts(undefined, {cdpPort: 9555})).not.toThrow()
    expect(getLastCDPPort()).toBe(9555)
  })
})
