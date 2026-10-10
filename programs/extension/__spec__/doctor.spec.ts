import * as fs from 'node:fs'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import {beforeEach, describe, expect, it, vi} from 'vitest'
import {
  DOCTOR_CHECKS,
  type DoctorReport,
  resolveDoctorBrowser,
  runDoctor
} from '../commands/doctor'

const state = vi.hoisted(() => ({mod: {} as any}))

vi.mock('../helpers/extension-develop-runtime', () => ({
  loadExtensionDevelopBridgeModule: async () => state.mod
}))

// The pid start-time probe shells out (PowerShell on Windows, where one cold
// call can take a minute), so the spec answers it; only the recycled pid case
// needs a start time at all.
const pidStart = vi.hoisted(() => ({value: null as number | null}))

vi.mock('../browsers/browsers-lib/resolve-live-pid', async () => {
  const actual = await vi.importActual<any>(
    '../browsers/browsers-lib/resolve-live-pid'
  )

  return {...actual, pidStartedAtMs: () => pidStart.value}
})

const peer = vi.hoisted(() => ({
  engine: '2.2.3' as string | undefined,
  conflicts: [] as Array<{name: string; version: string; range: string}>,
  unreadable: [] as string[]
}))

vi.mock('../helpers/rspack-peer-check', async () => {
  const actual = await vi.importActual<any>('../helpers/rspack-peer-check')

  return {
    ...actual,
    engineRspackVersion: () => peer.engine,
    scanRspackPeers: () => ({
      conflicts: peer.conflicts,
      unreadable: peer.unreadable
    })
  }
})

const ALL_CHECKS = [
  'peer-rspack',
  'ready-contract',
  'server-process',
  'port-agreement',
  'control-channel',
  'eval-token',
  'executor',
  'browser'
]

const byCheck = (report: DoctorReport) =>
  Object.fromEntries(report.checks.map((r) => [r.check, r]))

// A listening socket, and a port nothing listens on, so the browser leg's
// probe is decided by this process rather than by whatever runs on 9222.
async function listenOnFreePort(): Promise<{port: number; close(): void}> {
  const server = net.createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as net.AddressInfo).port

  return {port, close: () => server.close()}
}

async function closedPort(): Promise<number> {
  const server = await listenOnFreePort()
  server.close()
  await new Promise((resolve) => setTimeout(resolve, 10))

  return server.port
}

const stripAnsi = (text: string) => text.replace(/\[[0-9;]*m/g, '')

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
      pid: process.pid,
      startedAt: new Date().toISOString(),
      cdpPort: 9222,
      browserPid: process.pid
    }),
    readControlToken: () => 'tok',
    readPersistedControlPort: () => 4001,
    controlPortFilePath: (p: string, b: string) =>
      `${p}/.extension-js/control-port-${b}`,
    ...overrides
  }
}

beforeEach(() => {
  pidStart.value = null
  StubController.connectError = null
  StubController.readyFrame = {capabilities: {storage: true, reload: true}}
  StubController.probeResult = {ok: true, value: {}}
  state.mod = healthyModule()
})

describe('extension doctor', () => {
  it('passes every check on a healthy session', async () => {
    const report = await runDoctor('/proj', {})
    expect(report.checks.map((r) => r.check)).toEqual(ALL_CHECKS)
    expect(report.checks.every((r) => r.status === 'pass')).toBe(true)
  })

  it('fails ready-contract and skips everything else without a session', async () => {
    state.mod = healthyModule({readReadyContract: () => null})
    const results = await runDoctor('/proj', {})
    const r = byCheck(results)
    expect(r['ready-contract'].status).toBe('fail')
    expect(r['ready-contract'].remediation).toContain('extension dev')

    for (const check of ALL_CHECKS.slice(2)) {
      expect(r[check].status).toBe('skip')
      expect(r[check].detail).toContain('ready-contract')
    }
  })

  it('names a dependency whose @rspack/core peer range misses the engine', async () => {
    peer.conflicts = [
      {name: 'css-loader', version: '6.11.0', range: '0.x || 1.x'}
    ]

    try {
      const r = byCheck(await runDoctor('/proj', {}))
      expect(r['peer-rspack'].status).toBe('fail')
      expect(r['peer-rspack'].detail).toBe(
        'css-loader 6.11.0 accepts @rspack/core 0.x || 1.x, the engine ships 2.2.3'
      )

      expect(r['peer-rspack'].remediation).toBe(
        'Upgrade css-loader to 7.1.4 or newer, its peer range accepts @rspack/core 2, then install again'
      )
    } finally {
      peer.conflicts = []
    }
  })

  it('warns instead of passing when a dependency could not be read', async () => {
    peer.unreadable = ['extension', 'postcss-loader']

    try {
      const r = byCheck(await runDoctor('/proj', {}))
      expect(r['peer-rspack'].status).toBe('warn')
      expect(r['peer-rspack'].detail).toBe(
        'could not read 2 direct dependencies (extension, postcss-loader), their @rspack/core peer ranges are unverified'
      )

      expect(r['peer-rspack'].remediation).toContain('Install')

      peer.conflicts = [
        {name: 'css-loader', version: '6.11.0', range: '0.x || 1.x'}
      ]

      const failed = byCheck(await runDoctor('/proj', {}))
      expect(failed['peer-rspack'].status).toBe('fail')
      expect(failed['peer-rspack'].detail).toContain('css-loader 6.11.0')
      expect(failed['peer-rspack'].detail).toContain(
        '. could not read 2 direct dependencies (extension, postcss-loader)'
      )
    } finally {
      peer.conflicts = []
      peer.unreadable = []
    }
  })

  it('skips peer-rspack when the engine version cannot be read', async () => {
    peer.engine = undefined

    try {
      const r = byCheck(await runDoctor('/proj', {}))
      expect(r['peer-rspack'].status).toBe('skip')
      expect(r['peer-rspack'].detail).toContain("engine's @rspack/core version")
    } finally {
      peer.engine = '2.2.3'
    }
  })

  it('flags a dead server pid but still checks port-agreement and browser', async () => {
    state.mod = healthyModule({
      readReadyContract: () => ({
        controlPort: 4001,
        instanceId: 'inst-1',
        runId: 'run-A',
        status: 'ready',
        pid: 999999,
        cdpPort: 9222,
        browserPid: process.pid
      })
    })

    const r = byCheck(await runDoctor('/proj', {}))
    expect(r['server-process'].status).toBe('fail')
    expect(r['server-process'].detail).toContain('stale')
    expect(r['port-agreement'].status).toBe('pass')
    expect(r['control-channel'].status).toBe('skip')
    expect(r['eval-token'].status).toBe('skip')
    expect(r.executor.status).toBe('skip')
    expect(r.browser.status).toBe('pass')
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
    expect(r.executor.status).toBe('skip')

    StubController.connectError = new Error(
      'control channel refused the controller (code 4003: control channel not available)'
    )

    r = byCheck(await runDoctor('/proj', {}))
    expect(r['control-channel'].detail).toContain('control is off')
    expect(r['control-channel'].detail).not.toContain('not started with')
    expect(r['control-channel'].remediation).toContain('--allow-control')
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
    expect(r.executor.status).toBe('pass')
    expect(r.executor.detail).toContain('storage area exploded')
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
    expect(r.executor.status).toBe('fail')
    expect(r.executor.detail).toContain('no executor connected')
  })

  it('fails the executor when the probe comes back Unavailable after a mid-flight disconnect', async () => {
    state.mod = healthyModule({
      readReadyContract: () => ({
        controlPort: 4001,
        instanceId: 'inst-1',
        runId: 'run-A',
        status: 'ready',
        pid: process.pid,
        runtime: 'attached',
        executorAttachedAt: new Date().toISOString()
      })
    })

    StubController.probeResult = {
      ok: false,
      error: {
        name: 'Unavailable',
        message:
          "no executor connected: the extension's service worker disconnected 0s ago, MV3 workers idle out and reconnect on their own"
      }
    }

    const r = byCheck(await runDoctor('/proj', {}))
    expect(r.executor.status).toBe('fail')
    expect(r.executor.detail).toContain('disconnected 0s ago')
    expect(r.executor.detail).not.toContain('executor responded')
  })

  it('never reports pass for a probe the executor did not answer', async () => {
    StubController.probeResult = {
      ok: false,
      error: {name: 'Timeout', message: 'command timed out'}
    }

    const r = byCheck(await runDoctor('/proj', {}))
    expect(r.executor.status).toBe('fail')
    expect(r.executor.detail).toContain('did not answer')
    expect(r.executor.detail).not.toContain('executor responded')
    expect(r.executor.remediation).toContain('Reload the extension')
  })

  it('warns (not fails) the executor during the post-compile attach grace window', async () => {
    state.mod = healthyModule({
      readReadyContract: () => ({
        controlPort: 4001,
        instanceId: 'inst-1',
        runId: 'run-A',
        status: 'ready',
        pid: process.pid,
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
    expect(r.executor.status).toBe('warn')
    expect(
      (await runDoctor('/proj', {})).checks.some((c) => c.status === 'fail')
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
        compiledAt: new Date(Date.now() - 60_000).toISOString()
      })
    })

    StubController.probeResult = {
      ok: false,
      error: {name: 'Unavailable', message: 'no executor connected'}
    }

    const r = byCheck(await runDoctor('/proj', {}))
    expect(r.executor.status).toBe('fail')
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
    expect(r.executor.status).toBe('fail')
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
    expect(r.browser.status).toBe('fail')
    expect(r.browser.detail).toContain('code 21')
    expect(r.browser.remediation).toContain('Restart')
  })

  it('reports the browser leg as unknown when no cdpPort is stamped', async () => {
    state.mod = healthyModule({
      readReadyContract: () => ({
        controlPort: 4001,
        instanceId: 'inst-1',
        runId: 'run-A',
        status: 'ready',
        pid: process.pid
      })
    })

    const r = byCheck(await runDoctor('/proj', {}))
    expect(r.browser.status).toBe('skip')
    expect(r.browser.detail).toContain('unknown')
    expect(r.browser.remediation).toBeTruthy()
  })

  it('never passes the browser leg on a dead pid and a closed cdpPort', async () => {
    const cdpPort = await closedPort()
    state.mod = healthyModule({
      readReadyContract: () => ({
        controlPort: 4001,
        instanceId: 'inst-1',
        runId: 'run-A',
        status: 'ready',
        pid: process.pid,
        cdpPort,
        browserPid: 999999
      })
    })

    const r = byCheck(await runDoctor('/proj', {}))
    expect(r.browser.status).toBe('fail')
    expect(r.browser.detail).toContain('pid 999999 is gone')
    expect(r.browser.detail).toContain(`nothing answers cdpPort ${cdpPort}`)
    expect(r.browser.remediation).toContain('Restart')
  })

  it('diagnoses a Gecko session from rdpPort instead of calling it unknown', async () => {
    const rdp = await listenOnFreePort()
    state.mod = healthyModule({
      readReadyContract: () => ({
        controlPort: 4001,
        instanceId: 'inst-1',
        runId: 'run-A',
        status: 'ready',
        pid: process.pid,
        rdpPort: rdp.port
      })
    })

    try {
      const r = byCheck(await runDoctor('/proj', {browser: 'firefox'}))
      expect(r.browser.status).toBe('pass')
      expect(r.browser.detail).toContain(`rdpPort ${rdp.port}`)
      expect(r.browser.detail).not.toContain('unknown')
    } finally {
      rdp.close()
    }
  })

  it('fails the server leg when the contract pid has been reused', async () => {
    state.mod = healthyModule({
      readReadyContract: () => ({
        controlPort: 4001,
        instanceId: 'inst-1',
        runId: 'run-A',
        status: 'ready',
        // Alive, but this process started long after the contract was written,
        // which is what a recycled pid looks like.
        pid: process.pid,
        startedAt: '2020-01-01T00:00:00.000Z',
        cdpPort: 9222,
        browserPid: process.pid
      })
    })

    pidStart.value = Date.now()

    const r = byCheck(await runDoctor('/proj', {}))
    expect(r['server-process'].status).toBe('fail')
    expect(r['server-process'].detail).toContain('stale')
    expect(r['server-process'].detail).toContain('2020-01-01T00:00:00.000Z')
    expect(r['control-channel'].status).toBe('skip')
  })

  it('emits only check ids the contract documents', async () => {
    const report = await runDoctor('/proj', {})

    for (const check of report.checks) {
      expect(DOCTOR_CHECKS, `${check.check} is undocumented`).toContain(
        check.check
      )
    }
  })
})

describe('extension doctor (browser resolution)', () => {
  function writeContract(root: string, browser: string, contract: object) {
    const dir = path.join(root, 'dist', 'extension-js', browser)
    fs.mkdirSync(dir, {recursive: true})
    fs.writeFileSync(path.join(dir, 'ready.json'), JSON.stringify(contract))
  }

  function makeProject(browsers: string[], receipts: string[] = []): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-doctor-'))

    for (const browser of browsers) {
      writeContract(root, browser, {
        status: 'ready',
        command: 'dev',
        port: 8080,
        controlPort: 4001,
        instanceId: 'inst-1',
        pid: process.pid
      })
    }

    for (const browser of receipts) {
      writeContract(root, browser, {
        status: 'ready',
        command: 'build',
        port: null,
        controlPort: null,
        pid: 999999
      })
    }

    return root
  }

  it('never counts a build receipt as a session and names it only as the fallback', () => {
    const root = makeProject([], ['chrome', 'firefox'])

    try {
      expect(resolveDoctorBrowser(root, undefined)).toEqual({
        browser: 'chrome',
        sessionBrowsers: []
      })

      writeContract(root, 'edge', {status: 'ready', command: 'dev'})
      expect(resolveDoctorBrowser(root, undefined)).toEqual({
        browser: 'edge',
        sessionBrowsers: ['edge']
      })
    } finally {
      fs.rmSync(root, {recursive: true, force: true})
    }
  })

  it('names the absence of a session on a built-only project and never dials the receipt', async () => {
    const root = makeProject([], ['chrome', 'firefox'])
    let dialed = 0
    state.mod = healthyModule({
      readReadyContract: () => {
        dialed += 1

        return null
      }
    })

    try {
      const report = await runDoctor(root, {})
      const r = byCheck(report)
      expect(dialed).toBe(0)
      expect(r['session-resolution']).toBeUndefined()
      expect(r['ready-contract'].status).toBe('fail')
      expect(r['ready-contract'].detail).toContain('no dev session for chrome')
      expect(r['ready-contract'].detail).toMatch(
        /chrome[\\/]ready\.json is the receipt of an extension build run/
      )

      expect(r['ready-contract'].remediation).toContain(
        'extension dev --browser=chrome'
      )

      for (const check of ALL_CHECKS.slice(2)) {
        expect(r[check].status).toBe('skip')
      }

      const printed = report.checks
        .map((c) => `${c.detail} ${c.remediation ?? ''}`)
        .join('\n')
      expect(printed).not.toContain('died uncleanly')
      expect(printed).not.toContain('controlPort null')
      expect(printed).not.toContain('stale')
    } finally {
      fs.rmSync(root, {recursive: true, force: true})
    }
  })

  it('diagnoses the one live session next to build receipts without a warn', async () => {
    const root = makeProject(['firefox'], ['chrome', 'edge'])
    let asked: string | undefined
    state.mod = healthyModule({
      readReadyContract: (_p: string, browser: string) => {
        asked = browser

        return {
          controlPort: 4001,
          instanceId: 'inst-1',
          runId: 'run-A',
          status: 'ready',
          pid: process.pid,
          startedAt: new Date().toISOString(),
          cdpPort: 9222,
          browserPid: process.pid
        }
      }
    })

    try {
      const report = await runDoctor(root, {})
      expect(asked).toBe('firefox')
      expect(report.checks.map((r) => r.check)).toEqual(ALL_CHECKS)
      expect(report.checks.every((r) => r.status === 'pass')).toBe(true)
    } finally {
      fs.rmSync(root, {recursive: true, force: true})
    }
  })

  it('prefers the single live session over the chromium default', () => {
    const root = makeProject(['chrome'])

    try {
      expect(resolveDoctorBrowser(root, undefined).browser).toBe('chrome')
    } finally {
      fs.rmSync(root, {recursive: true, force: true})
    }
  })

  it('keeps chromium when no session contract exists', () => {
    const root = makeProject([])

    try {
      expect(resolveDoctorBrowser(root, undefined).browser).toBe('chromium')
    } finally {
      fs.rmSync(root, {recursive: true, force: true})
    }
  })

  it('honors an explicit --browser without scanning contracts', () => {
    const root = makeProject(['chrome'])

    try {
      expect(resolveDoctorBrowser(root, 'firefox').browser).toBe('firefox')
    } finally {
      fs.rmSync(root, {recursive: true, force: true})
    }
  })

  it('diagnoses the resolved session and never warns for a single one', async () => {
    const root = makeProject(['chrome'])
    let asked: string | undefined
    state.mod = healthyModule({
      readReadyContract: (_p: string, browser: string) => {
        asked = browser

        return {
          controlPort: 4001,
          instanceId: 'inst-1',
          runId: 'run-A',
          status: 'ready',
          pid: process.pid,
          startedAt: new Date().toISOString(),
          cdpPort: 9222,
          browserPid: process.pid
        }
      }
    })

    try {
      const report = await runDoctor(root, {})
      expect(asked).toBe('chrome')
      expect(report.checks.map((r) => r.check)).toEqual(ALL_CHECKS)
    } finally {
      fs.rmSync(root, {recursive: true, force: true})
    }
  })

  it('names every live session and the diagnosed pick when several exist', async () => {
    const root = makeProject(['chrome', 'firefox'])

    try {
      const r = byCheck(await runDoctor(root, {}))
      expect(r['session-resolution'].status).toBe('warn')
      expect(r['session-resolution'].detail).toContain('chrome, firefox')
      expect(r['session-resolution'].detail).toContain('diagnosing chrome')
      expect(r['session-resolution'].remediation).toContain('--browser')
    } finally {
      fs.rmSync(root, {recursive: true, force: true})
    }
  })
})

describe('extension doctor (command surface)', () => {
  it('emits a healthy schema-1 envelope and exits 0 on a healthy session', async () => {
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
      const frame = JSON.parse(String(logSpy.mock.calls[0][0]))
      expect(frame).toMatchObject({
        schema: 1,
        ok: true,
        command: 'doctor',
        status: 'healthy',
        error: null,
        warnings: []
      })

      expect(frame.value.every((r: any) => r.status === 'pass')).toBe(true)
      expect(frame.browser).toBe('chromium')
    } finally {
      vi.restoreAllMocks()
    }
  })

  it('emits an unhealthy envelope that still carries the checks and exits 1', async () => {
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
        '/proj',
        '--output',
        'json'
      ])
      expect(code).toBe(1)
      const frame = JSON.parse(String(logSpy.mock.calls[0][0]))
      expect(frame.schema).toBe(1)
      expect(frame.ok).toBe(false)
      expect(frame.status).toBe('unhealthy')
      expect(frame.error.code).toBe('E_SESSION_NOT_FOUND')
      // A failure frame carrying a payload: the check list IS the diagnosis,
      // and it must survive ENVELOPE.fail rather than be nulled out.
      expect(frame.value.map((r: any) => r.check)).toEqual(ALL_CHECKS)
      expect(frame.hint).toContain('extension dev')
    } finally {
      vi.restoreAllMocks()
    }
  })

  it('reports a built-only project as no session in the envelope', async () => {
    const {makeProgram, runCli, stubProcessExit} = await import(
      './command-harness'
    )
    const {registerDoctorCommand} = await import('../commands/doctor')
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-doctor-'))
    const dir = path.join(root, 'dist', 'extension-js', 'chrome')
    fs.mkdirSync(dir, {recursive: true})
    fs.writeFileSync(
      path.join(dir, 'ready.json'),
      JSON.stringify({
        status: 'ready',
        command: 'build',
        port: null,
        controlPort: null,
        pid: 999999
      })
    )

    state.mod = healthyModule({readReadyContract: () => null})
    stubProcessExit()
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      const code = await runCli(makeProgram(registerDoctorCommand), [
        'doctor',
        root,
        '--output',
        'json'
      ])
      expect(code).toBe(1)
      const raw = String(logSpy.mock.calls[0][0])
      const frame = JSON.parse(raw)
      expect(frame.error.code).toBe('E_SESSION_NOT_FOUND')
      expect(frame.hint).toContain('extension dev --browser=chrome')
      expect(raw).not.toContain('died uncleanly')
      expect(raw).not.toContain('multiple live sessions')
    } finally {
      vi.restoreAllMocks()
      fs.rmSync(root, {recursive: true, force: true})
    }
  })

  it('maps each failing check to its own code rather than one bucket', async () => {
    const {makeProgram, runCli, stubProcessExit} = await import(
      './command-harness'
    )
    const {registerDoctorCommand} = await import('../commands/doctor')
    // eval-token is the first failure here, so it, not ready-contract, names
    // the frame.
    StubController.readyFrame = {capabilities: {eval: true, storage: true}}
    state.mod = healthyModule({readControlToken: () => null})
    stubProcessExit()
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      const code = await runCli(makeProgram(registerDoctorCommand), [
        'doctor',
        '/proj',
        '--output',
        'json'
      ])
      expect(code).toBe(1)
      const frame = JSON.parse(String(logSpy.mock.calls[0][0]))
      expect(frame.error.code).toBe('E_TOKEN_MISSING')
      expect(frame.error.code).not.toBe('E_DOCTOR_CHECKS_FAILED')
    } finally {
      vi.restoreAllMocks()
    }
  })

  it('reports the code a throw out of the doctor run declares', async () => {
    const {makeProgram, runCli, stubProcessExit} = await import(
      './command-harness'
    )
    const {registerDoctorCommand} = await import('../commands/doctor')
    state.mod = healthyModule({
      readReadyContract: () => {
        throw Object.assign(new Error('runtime is not built'), {
          code: 'E_RUNTIME_NOT_FOUND'
        })
      }
    })

    stubProcessExit()
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      const code = await runCli(makeProgram(registerDoctorCommand), [
        'doctor',
        '/proj',
        '--output',
        'json'
      ])
      expect(code).toBe(1)
      const frame = JSON.parse(String(logSpy.mock.calls[0][0]))
      expect(frame).toMatchObject({
        ok: false,
        command: 'doctor',
        status: 'failed',
        error: {code: 'E_RUNTIME_NOT_FOUND', message: 'runtime is not built'}
      })
    } finally {
      vi.restoreAllMocks()
    }
  })

  it('emits a failure envelope when the doctor run itself throws', async () => {
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
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      const code = await runCli(makeProgram(registerDoctorCommand), [
        'doctor',
        '/proj',
        '--output',
        'json'
      ])
      expect(code).toBe(1)
      const frame = JSON.parse(String(logSpy.mock.calls[0][0]))
      expect(frame).toMatchObject({
        schema: 1,
        ok: false,
        command: 'doctor',
        status: 'failed',
        value: null
      })

      expect(frame.error.code).toBe('E_INTERNAL')
      expect(frame.error.message).toContain('contract unreadable')
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
      const lines = logSpy.mock.calls.map((c) => stripAnsi(String(c[0])))
      expect(lines[0]).toContain('doctor (chromium)')
      expect(lines.some((l) => l.includes('✗ ready-contract'))).toBe(true)
      expect(lines[lines.length - 1]).toContain('ready-contract:')
    } finally {
      vi.restoreAllMocks()
    }
  })

  it('colors the check glyphs by state on a color terminal and not under NO_COLOR', async () => {
    const {makeProgram, runCli, stubProcessExit} = await import(
      './command-harness'
    )
    const {registerDoctorCommand} = await import('../commands/doctor')
    state.mod = healthyModule({
      readReadyContract: () => ({
        controlPort: 4001,
        instanceId: 'inst-1',
        runId: 'run-A',
        status: 'ready',
        pid: 999999,
        cdpPort: 9222,
        browserPid: process.pid
      })
    })

    stubProcessExit()
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const env = {
      FORCE_COLOR: process.env.FORCE_COLOR,
      NO_COLOR: process.env.NO_COLOR
    }
    const rowFor = (check: string) =>
      logSpy.mock.calls
        .map((c) => String(c[0]))
        .find((l) => stripAnsi(l).includes(` ${check} `)) as string

    try {
      process.env.FORCE_COLOR = '1'
      Reflect.deleteProperty(process.env, 'NO_COLOR')
      expect(
        await runCli(makeProgram(registerDoctorCommand), ['doctor', '/proj'])
      ).toBe(1)

      expect(rowFor('server-process')).toContain('[31m✗[39m')
      expect(rowFor('port-agreement')).toContain('[32m✓[39m')

      logSpy.mockClear()
      process.env.FORCE_COLOR = '0'
      process.env.NO_COLOR = '1'
      expect(
        await runCli(makeProgram(registerDoctorCommand), ['doctor', '/proj'])
      ).toBe(1)

      expect(rowFor('server-process')).toContain('  ✗ server-process')
      expect(rowFor('port-agreement')).toContain('  ✓ port-agreement')
      expect(rowFor('server-process')).not.toContain('[')
    } finally {
      process.env.FORCE_COLOR = env.FORCE_COLOR
      process.env.NO_COLOR = env.NO_COLOR
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

describe('extension doctor (session identity in the report)', () => {
  // The standard layout: the package root holds the session files, the
  // manifest lives in src/, and the argument points at src/.
  function makeSrcLayoutProject(browser: string): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-doctor-src-'))
    fs.mkdirSync(path.join(root, 'src'), {recursive: true})
    fs.writeFileSync(path.join(root, 'package.json'), '{"name":"p"}')
    fs.writeFileSync(
      path.join(root, 'src', 'manifest.json'),
      '{"manifest_version":3,"name":"p","version":"1.0"}'
    )

    const dir = path.join(root, 'dist', 'extension-js', browser)
    fs.mkdirSync(dir, {recursive: true})
    fs.writeFileSync(
      path.join(dir, 'ready.json'),
      JSON.stringify({
        status: 'ready',
        command: 'dev',
        controlPort: 4001,
        instanceId: 'inst-1',
        pid: process.pid
      })
    )

    return root
  }

  it('names the diagnosed session in the header and never the raw argument', async () => {
    const {makeProgram, runCli, stubProcessExit} = await import(
      './command-harness'
    )
    const {registerDoctorCommand} = await import('../commands/doctor')
    const root = makeSrcLayoutProject('firefox')
    state.mod = healthyModule({resolveSessionProjectRoot: () => root})
    stubProcessExit()
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      expect(
        await runCli(makeProgram(registerDoctorCommand), [
          'doctor',
          path.join(root, 'src')
        ])
      ).toBe(0)

      const header = stripAnsi(String(logSpy.mock.calls[0][0]))
      expect(header).toContain('doctor (firefox)')
      expect(header).not.toContain('chromium')
    } finally {
      vi.restoreAllMocks()
      fs.rmSync(root, {recursive: true, force: true})
    }
  })

  it('names the diagnosed session on the json envelope', async () => {
    const {makeProgram, runCli, stubProcessExit} = await import(
      './command-harness'
    )
    const {registerDoctorCommand} = await import('../commands/doctor')
    const root = makeSrcLayoutProject('firefox')
    state.mod = healthyModule({resolveSessionProjectRoot: () => root})
    stubProcessExit()
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      expect(
        await runCli(makeProgram(registerDoctorCommand), [
          'doctor',
          path.join(root, 'src'),
          '--output',
          'json'
        ])
      ).toBe(0)

      const frame = JSON.parse(String(logSpy.mock.calls[0][0]))
      expect(frame.browser).toBe('firefox')
      // The payload keeps the shape every host already reads: a bare list.
      expect(frame.value.map((c: any) => c.check)).toEqual(ALL_CHECKS)
    } finally {
      vi.restoreAllMocks()
      fs.rmSync(root, {recursive: true, force: true})
    }
  })
})

// The golden frames are what a host copies as the doctor result shape without
// running doctor. Validating them against the envelope schema alone let them
// document seven checks while the command emitted eight.
describe('the golden doctor envelopes document the real frames', () => {
  const goldenPath = (name: string) =>
    path.join(__dirname, 'contract', `golden.doctor.${name}.json`)

  const golden = (name: string) =>
    JSON.parse(fs.readFileSync(goldenPath(name), 'utf8'))

  async function emitJsonFrame() {
    const {makeProgram, runCli, stubProcessExit} = await import(
      './command-harness'
    )
    const {registerDoctorCommand} = await import('../commands/doctor')
    stubProcessExit()
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      await runCli(makeProgram(registerDoctorCommand), [
        'doctor',
        '/proj',
        '--output',
        'json'
      ])

      return JSON.parse(String(logSpy.mock.calls.at(-1)?.[0]))
    } finally {
      vi.restoreAllMocks()
    }
  }

  function expectSameShape(
    frame: Record<string, any>,
    fixture: Record<string, any>
  ) {
    expect(
      Object.keys(fixture).sort(),
      'the golden envelope names keys the doctor frame does not, or misses some'
    ).toEqual(Object.keys(frame).sort())

    expect(fixture.command).toBe(frame.command)
    expect(fixture.status).toBe(frame.status)
    expect(fixture.browser).toBe(frame.browser)
    expect(
      fixture.value.map((c: any) => c.check),
      'the golden value under-documents the checks `doctor --output json` emits'
    ).toEqual(frame.value.map((c: any) => c.check))

    expect(fixture.value.map((c: any) => c.status)).toEqual(
      frame.value.map((c: any) => c.status)
    )
  }

  it('documents the healthy frame the command emits', async () => {
    expectSameShape(await emitJsonFrame(), golden('healthy'))
  })

  it('documents the session-not-found frame the command emits', async () => {
    state.mod = healthyModule({readReadyContract: () => null})
    const frame = await emitJsonFrame()
    const fixture = golden('session-not-found')
    expectSameShape(frame, fixture)
    expect(fixture.error.code).toBe(frame.error.code)
    expect(fixture.error.message).toBe(frame.error.message)
  })
})
