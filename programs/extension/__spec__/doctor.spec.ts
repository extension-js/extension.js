import {beforeEach, describe, expect, it, vi} from 'vitest'
import {type DoctorCheckResult, runDoctor} from '../commands/doctor'

const state = vi.hoisted(() => ({mod: {} as any}))

vi.mock('../helpers/extension-develop-runtime', () => ({
  loadExtensionDevelopBridgeModule: async () => state.mod
}))

const ALL_CHECKS = [
  'ready-contract',
  'server-process',
  'port-agreement',
  'control-channel',
  'eval-token',
  'executor',
  'browser'
]

const byCheck = (results: DoctorCheckResult[]) =>
  Object.fromEntries(results.map((r) => [r.check, r]))

class StubController {
  static connectError: Error | null = null
  static readyFrame: any = {capabilities: {storage: true, reload: true}}
  static probeResult: any = {ok: true, value: {}}

  async connect() {
    if (StubController.connectError) throw StubController.connectError
    return StubController.readyFrame
  }
  async command() {
    if (StubController.probeResult instanceof Error) {
      throw StubController.probeResult
    }
    return StubController.probeResult
  }
  close() {}
}

function healthyModule(overrides: Record<string, unknown> = {}) {
  return {
    BridgeController: StubController,
    readReadyContract: () => ({
      controlPort: 4001,
      instanceId: 'inst-1',
      runId: 'run-A',
      status: 'ready',
      pid: process.pid
    }),
    readControlToken: () => 'tok',
    readPersistedControlPort: () => 4001,
    controlPortFilePath: (p: string, b: string) =>
      `${p}/.extension-js/control-port-${b}`,
    ...overrides
  }
}

beforeEach(() => {
  StubController.connectError = null
  StubController.readyFrame = {capabilities: {storage: true, reload: true}}
  StubController.probeResult = {ok: true, value: {}}
  state.mod = healthyModule()
})

describe('extension doctor', () => {
  it('passes every check on a healthy session', async () => {
    const results = await runDoctor('/proj', {})
    expect(results.map((r) => r.check)).toEqual(ALL_CHECKS)
    expect(results.every((r) => r.status === 'pass')).toBe(true)
  })

  it('fails ready-contract and skips everything else without a session', async () => {
    state.mod = healthyModule({readReadyContract: () => null})
    const results = await runDoctor('/proj', {})
    const r = byCheck(results)
    expect(r['ready-contract'].status).toBe('fail')
    expect(r['ready-contract'].remediation).toContain('extension dev')
    for (const check of ALL_CHECKS.slice(1)) {
      expect(r[check].status).toBe('skip')
      expect(r[check].detail).toContain('ready-contract')
    }
  })

  it('flags a dead server pid but still checks port-agreement and browser', async () => {
    state.mod = healthyModule({
      readReadyContract: () => ({
        controlPort: 4001,
        instanceId: 'inst-1',
        runId: 'run-A',
        status: 'ready',
        pid: 999999
      })
    })
    const r = byCheck(await runDoctor('/proj', {}))
    expect(r['server-process'].status).toBe('fail')
    expect(r['server-process'].detail).toContain('stale')
    expect(r['port-agreement'].status).toBe('pass')
    expect(r['control-channel'].status).toBe('skip')
    expect(r['eval-token'].status).toBe('skip')
    expect(r['executor'].status).toBe('skip')
    expect(r['browser'].status).toBe('pass')
  })

  it('names a persisted-port mismatch as the stale-SW precondition', async () => {
    state.mod = healthyModule({readPersistedControlPort: () => 9999})
    const r = byCheck(await runDoctor('/proj', {}))
    expect(r['port-agreement'].status).toBe('fail')
    expect(r['port-agreement'].detail).toContain('9999')
    expect(r['port-agreement'].detail).toContain('4001')
    expect(r['port-agreement'].remediation).toContain('cached service worker')
  })

  it('skips port-agreement when the installed engine lacks the export', async () => {
    const mod = healthyModule()
    delete (mod as any).readPersistedControlPort
    state.mod = mod
    const r = byCheck(await runDoctor('/proj', {}))
    expect(r['port-agreement'].status).toBe('skip')
  })

  it('maps control-channel close codes to causes', async () => {
    StubController.connectError = new Error(
      'control channel refused the controller (code 4001: instanceId mismatch)'
    )
    let r = byCheck(await runDoctor('/proj', {}))
    expect(r['control-channel'].status).toBe('fail')
    expect(r['control-channel'].detail).toContain('instanceId')
    expect(r['eval-token'].status).toBe('skip')
    expect(r['executor'].status).toBe('skip')

    StubController.connectError = new Error(
      'control channel refused the controller (code 4003: control channel not available)'
    )
    r = byCheck(await runDoctor('/proj', {}))
    expect(r['control-channel'].detail).toContain('--allow-control')
  })

  it('requires a readable token only when eval is enabled', async () => {
    StubController.readyFrame = {capabilities: {eval: true, storage: true}}
    state.mod = healthyModule({readControlToken: () => null})
    let r = byCheck(await runDoctor('/proj', {}))
    expect(r['eval-token'].status).toBe('fail')
    expect(r['eval-token'].remediation).toContain('project root')

    StubController.readyFrame = {capabilities: {eval: false, storage: true}}
    state.mod = healthyModule({readControlToken: () => null})
    r = byCheck(await runDoctor('/proj', {}))
    expect(r['eval-token'].status).toBe('pass')
    expect(r['eval-token'].detail).toContain('eval disabled')
  })

  it('treats any routed probe result as a live executor', async () => {
    StubController.probeResult = {
      ok: false,
      error: {name: 'Error', message: 'storage area exploded'}
    }
    const r = byCheck(await runDoctor('/proj', {}))
    expect(r['executor'].status).toBe('pass')
    expect(r['executor'].detail).toContain('storage area exploded')
  })

  it('surfaces the broker Unavailable diagnosis verbatim on executor failure', async () => {
    StubController.probeResult = {
      ok: false,
      error: {
        name: 'Unavailable',
        message:
          'no executor connected: no extension service worker has connected since this dev session started'
      }
    }
    const r = byCheck(await runDoctor('/proj', {}))
    expect(r['executor'].status).toBe('fail')
    expect(r['executor'].detail).toContain('no executor connected')
  })

  it('warns (not fails) the executor during the post-compile attach grace window', async () => {
    state.mod = healthyModule({
      readReadyContract: () => ({
        controlPort: 4001,
        instanceId: 'inst-1',
        runId: 'run-A',
        status: 'ready',
        pid: process.pid,
        // Compiled a moment ago; SW has not attached yet.
        compiledAt: new Date().toISOString()
      })
    })
    StubController.probeResult = {
      ok: false,
      error: {
        name: 'Unavailable',
        message:
          'no executor connected: no extension service worker has connected since this dev session started'
      }
    }
    const r = byCheck(await runDoctor('/proj', {}))
    expect(r['executor'].status).toBe('warn')
    // A warn must not make the session unhealthy.
    expect(
      (await runDoctor('/proj', {})).some((c) => c.status === 'fail')
    ).toBe(false)
  })

  it('fails the executor once the grace window has elapsed with no attach', async () => {
    state.mod = healthyModule({
      readReadyContract: () => ({
        controlPort: 4001,
        instanceId: 'inst-1',
        runId: 'run-A',
        status: 'ready',
        pid: process.pid,
        // Compiled well over the grace window ago, still no SW.
        compiledAt: new Date(Date.now() - 60_000).toISOString()
      })
    })
    StubController.probeResult = {
      ok: false,
      error: {name: 'Unavailable', message: 'no executor connected'}
    }
    const r = byCheck(await runDoctor('/proj', {}))
    expect(r['executor'].status).toBe('fail')
  })

  it('does not grace-warn the executor once the SW has attached (runtime attached)', async () => {
    state.mod = healthyModule({
      readReadyContract: () => ({
        controlPort: 4001,
        instanceId: 'inst-1',
        runId: 'run-A',
        status: 'ready',
        pid: process.pid,
        compiledAt: new Date().toISOString(),
        runtime: 'attached',
        executorAttachedAt: new Date().toISOString()
      })
    })
    StubController.probeResult = {
      ok: false,
      error: {name: 'Unavailable', message: 'no executor connected'}
    }
    const r = byCheck(await runDoctor('/proj', {}))
    expect(r['executor'].status).toBe('fail')
  })

  it('fails the browser check when the browser exited under a live server', async () => {
    state.mod = healthyModule({
      readReadyContract: () => ({
        controlPort: 4001,
        instanceId: 'inst-1',
        runId: 'run-A',
        status: 'ready',
        pid: process.pid,
        browserExitedAt: '2026-07-16T00:00:00Z',
        browserExitCode: 21
      })
    })
    const r = byCheck(await runDoctor('/proj', {}))
    expect(r['browser'].status).toBe('fail')
    expect(r['browser'].detail).toContain('code 21')
    expect(r['browser'].remediation).toContain('Restart')
  })
})

describe('extension doctor (command surface)', () => {
  it('prints json results and exits 0 on a healthy session', async () => {
    const {makeProgram, runCli, stubProcessExit} = await import(
      './command-harness'
    )
    const {registerDoctorCommand} = await import('../commands/doctor')
    stubProcessExit()
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const code = await runCli(makeProgram(registerDoctorCommand), [
        'doctor',
        '/proj',
        '--output',
        'json'
      ])
      expect(code).toBe(0)
      const results = JSON.parse(String(logSpy.mock.calls[0][0]))
      expect(results.every((r: any) => r.status === 'pass')).toBe(true)
    } finally {
      vi.restoreAllMocks()
    }
  })

  it('prints the pretty report with the first remediation and exits 1 on failure', async () => {
    const {makeProgram, runCli, stubProcessExit} = await import(
      './command-harness'
    )
    const {registerDoctorCommand} = await import('../commands/doctor')
    state.mod = healthyModule({readReadyContract: () => null})
    stubProcessExit()
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const code = await runCli(makeProgram(registerDoctorCommand), [
        'doctor',
        '/proj'
      ])
      expect(code).toBe(1)
      const lines = logSpy.mock.calls.map((c) => String(c[0]))
      expect(lines[0]).toContain('doctor (chromium)')
      expect(lines.some((l) => l.includes('✗ ready-contract'))).toBe(true)
      // The advisory line repeats the first failing check's remediation.
      expect(lines[lines.length - 1]).toContain('ready-contract:')
    } finally {
      vi.restoreAllMocks()
    }
  })

  it('exits 1 with the error message when the doctor run itself throws', async () => {
    const {makeProgram, runCli, stubProcessExit} = await import(
      './command-harness'
    )
    const {registerDoctorCommand} = await import('../commands/doctor')
    state.mod = healthyModule({
      readReadyContract: () => {
        throw new Error('contract unreadable')
      }
    })
    stubProcessExit()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const code = await runCli(makeProgram(registerDoctorCommand), [
        'doctor',
        '/proj'
      ])
      expect(code).toBe(1)
      expect(String(errorSpy.mock.calls[0][0])).toContain('contract unreadable')
    } finally {
      vi.restoreAllMocks()
    }
  })
})
