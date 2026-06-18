// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗██╔════╝
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝███████╗
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗╚════██║
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║███████║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

// Instance-port fidelity: every piece of tooling (a reload, a readiness check,
// a source inspection) must stay faithful to its own instance's debug port. The
// registry used to fall back to a process-wide last-launched port whenever the
// instance id was missing, so with two live instances in one process (chrome +
// edge from one `dev` command) the earlier instance's tooling silently captured
// the later browser. These specs simulate two concurrent instances per engine —
// no real browser — and cover the faithful case, today's cross-talk case, and
// the cannot-tell case, plus the single-browser-unchanged invariant.

import {beforeEach, describe, expect, it} from 'vitest'
import {
  AmbiguousInstanceError,
  getLastCDPPort,
  getLastRDPPort,
  resolvePortForInstance,
  setInstancePorts
} from '../browsers-lib/instance-registry'
import {RemoteFirefox} from '../run-firefox/firefox-source-inspection/remote-firefox'
import {deriveDebugPortWithInstance} from '../browsers-lib/shared-utils'

// The registry is a module-global singleton; isolate every test by re-seeding
// two live instances (chrome launched first, then edge) before each case. There
// is no public "clear" — pool: forks + maxWorkers: 1 keeps the module fresh per
// file, and each test only asserts on ids it set itself.
const CHROME_CDP = 9222
const EDGE_CDP = 9333
const CHROME_RDP = 6000
const EDGE_RDP = 6111

beforeEach(() => {
  // Two concurrent instances in one process. Edge launches LAST, so the old
  // process-wide fallback would have resolved everything to edge's ports.
  setInstancePorts('chrome-instance', {cdpPort: CHROME_CDP, rdpPort: CHROME_RDP})
  setInstancePorts('edge-instance', {cdpPort: EDGE_CDP, rdpPort: EDGE_RDP})
})

describe('resolvePortForInstance — the one shared contract', () => {
  it('faithful: a known instance resolves to its OWN registered port (cdp + rdp)', () => {
    expect(resolvePortForInstance('chrome-instance', 'cdp')).toBe(CHROME_CDP)
    expect(resolvePortForInstance('edge-instance', 'cdp')).toBe(EDGE_CDP)
    expect(resolvePortForInstance('chrome-instance', 'rdp')).toBe(CHROME_RDP)
    expect(resolvePortForInstance('edge-instance', 'rdp')).toBe(EDGE_RDP)
  })

  it('does NOT cross streams: chrome never resolves to the last-launched edge port', () => {
    // The defect: with the id present, chrome must reach chrome (9222), never
    // the most-recently-launched edge (9333).
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
      // The message must not silently surface the last-launched port.
      expect(err.message).not.toContain(String(EDGE_CDP))
    }
  })

  it('known-but-unregistered instance defers to the caller fallback, never another instance port', () => {
    // The launcher may register a port slightly after a waiter starts. Until
    // then we return the caller's own per-instance default — not edge's port.
    const myDefault = 9555
    expect(resolvePortForInstance('not-yet-registered', 'cdp', myDefault)).toBe(
      myDefault
    )
    // And without a fallback we yield undefined (poll again) rather than edge.
    expect(
      resolvePortForInstance('not-yet-registered', 'cdp')
    ).toBeUndefined()
  })

  it('a caller-supplied fallback is honored for the cannot-tell case (no throw)', () => {
    expect(resolvePortForInstance(undefined, 'cdp', 9999)).toBe(9999)
  })

  it('the process-wide last-launched telemetry is NOT a resolution path', () => {
    // getLast* still report the most recent launch (edge), but resolving for
    // chrome must ignore them entirely.
    expect(getLastCDPPort()).toBe(EDGE_CDP)
    expect(getLastRDPPort()).toBe(EDGE_RDP)
    expect(resolvePortForInstance('chrome-instance', 'cdp')).toBe(CHROME_CDP)
  })
})

describe('chromium readiness — faithful per-instance CDP resolution', () => {
  // Re-create the resolution the readiness waiter performs: prefer this
  // instance's registered port, else fall back to the caller's own derived
  // port. (waitForChromeRemoteDebugging would poll the network beyond this; we
  // assert only the port it selects.)
  const resolveReadinessPort = (derived: number, instanceId?: string) => {
    try {
      const fromRegistry = resolvePortForInstance(instanceId, 'cdp', derived)
      if (typeof fromRegistry === 'number' && fromRegistry > 0) return fromRegistry
    } catch {
      // matches readiness.ts: swallow and keep the derived port
    }
    return derived
  }

  it('faithful: chrome readiness reaches chrome (9222), edge readiness reaches edge (9333)', () => {
    expect(resolveReadinessPort(1, 'chrome-instance')).toBe(CHROME_CDP)
    expect(resolveReadinessPort(1, 'edge-instance')).toBe(EDGE_CDP)
  })

  it('today-cross-talk case is fixed: chrome readiness no longer lands on edge', () => {
    expect(resolveReadinessPort(1, 'chrome-instance')).not.toBe(EDGE_CDP)
  })

  it('cannot-tell: with no instance id, readiness uses the caller-derived port, NOT last-launched edge', () => {
    const derived = 9501
    expect(resolveReadinessPort(derived, undefined)).toBe(derived)
    expect(resolveReadinessPort(derived, undefined)).not.toBe(EDGE_CDP)
  })

  it('single-browser run is unchanged: the one instance resolves to its own port', () => {
    // Only one instance live in a fresh-ish view: its registered port wins.
    expect(resolveReadinessPort(1, 'chrome-instance')).toBe(CHROME_CDP)
  })
})

describe('firefox RemoteFirefox.resolveRdpPort — faithful per-instance RDP resolution', () => {
  // resolveRdpPort is private; reach it via the prototype the way the codebase's
  // own internals do, with no network and no real Firefox.
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
    return (
      inst as unknown as {resolveRdpPort: () => number}
    ).resolveRdpPort()
  }

  it('faithful: firefox tooling for an instance reaches that instance RDP port', () => {
    // basePort folds into the derived offset; the registered port must override.
    expect(callResolve('chrome-instance', 5000)).toBe(CHROME_RDP)
    expect(callResolve('edge-instance', 5000)).toBe(EDGE_RDP)
  })

  it('today-cross-talk case is fixed: firefox does not fall back to the last RDP port', () => {
    // An UNREGISTERED instance must resolve to its OWN deterministic derived
    // port, never the most-recently-launched edge RDP port.
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
})
