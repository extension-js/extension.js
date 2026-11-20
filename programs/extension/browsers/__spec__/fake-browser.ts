import type {ChildProcess} from 'node:child_process'
import {EventEmitter} from 'node:events'
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import {PassThrough} from 'node:stream'
import {expect, vi} from 'vitest'
import {
  claimDebugPortNear,
  type DebugPortClaim
} from '../browsers-lib/debug-port-claim'
import {
  type ChromiumLaunchDependencies,
  type ChromiumLocatorName,
  chromiumLaunchDefaults
} from '../run-chromium/chromium-launch/launch-dependencies'
import {
  type FirefoxLaunchDependencies,
  firefoxLaunchDefaults,
  type GeckoLocatorName
} from '../run-firefox/firefox-launch/launch-dependencies'
import {
  buildRdpFrame,
  parseRdpFrame
} from '../run-firefox/rdp/remote-firefox/rdp-wire'

// No process can carry this pid, so a kill that slipped past the fake's own
// teardown would name nothing, on Windows included.
export const FAKE_BROWSER_PID = 2 ** 30

// Variables a launch reads to find a browser or to change what it runs. The
// fake clears them, so a developer's shell cannot steer a spec.
const STEERING_VARIABLES = [
  'CHROME_BINARY',
  'CHROME_PATH',
  'CHROME_FOR_TESTING_PATH',
  'CHROMIUM_BINARY',
  'EDGE_BINARY',
  'FIREFOX_BINARY',
  'PUPPETEER_CACHE_DIR',
  'PUPPETEER_EXECUTABLE_PATH',
  'PLAYWRIGHT_BROWSERS_PATH',
  'EXTENSIONJS_BINARIES_IN_DIST',
  'EXTENSION_PREFER_CHROMIUM_SNAPSHOT',
  'EXTENSION_INTERNAL_SKIP_SYSTEM_BROWSERS',
  'EXTENSION_USE_SYSTEM_PROFILE',
  'EXTJS_USE_SYSTEM_PROFILE',
  'EXTENSION_BROWSER_FLAGS',
  'EXTENSION_HEADLESS',
  'MOZ_HEADLESS',
  'EXTENSION_WATCH_TIMEOUT_MS',
  'EXTENSION_DEV_WATCH_TIMEOUT_MS',
  'EXTJS_WATCH_TIMEOUT_MS',
  'EXTJS_DEV_WATCH_TIMEOUT_MS',
  'EXTENSION_AUTHOR_MODE',
  'EXTENSION_DEBUG',
  'npm_config_user_agent',
  'WSL_DISTRO_NAME',
  'WSL_INTEROP'
]

export type FakeExit = {code: number | null; signal: NodeJS.Signals | null}

// What the process did after it spawned. Each is one way a launch can end.
export type FakeBrowserScript = {
  // Whether the browser listens on its debugging port. Default true.
  bindsPort?: boolean
  // Leaves this long after it spawned, before anything answered.
  exitsAfterMs?: number
  exit?: FakeExit
  // Lines the process wrote to stderr before anything else.
  stderr?: string[]
  // How the debugging protocol behaves once a client talks to it.
  handshake?: 'answers' | 'dies' | 'silent'
  // Each protocol answer waits this long.
  answerDelayMs?: number
  // Whether a termination signal ends the process. Default true.
  diesOnSignal?: boolean
  // A spawn that never produced a process.
  spawnError?: Error
}

export class FakeChild extends EventEmitter {
  pid: number | undefined = FAKE_BROWSER_PID
  killed = false
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null
  spawnfile: string
  spawnargs: string[]
  stdout: PassThrough | null
  stderr: PassThrough | null
  stdio: Array<PassThrough | null>
  readonly signals: Array<NodeJS.Signals | number | undefined> = []
  exited = false
  private readonly diesOnSignal: boolean
  private readonly onExit: () => void

  constructor(input: {
    binary: string
    args: string[]
    streams: Array<PassThrough | null>
    diesOnSignal: boolean
    onExit: () => void
  }) {
    super()
    this.spawnfile = input.binary
    this.spawnargs = [input.binary, ...input.args]
    this.stdio = input.streams
    this.stdout = input.streams[1] ?? null
    this.stderr = input.streams[2] ?? null
    this.diesOnSignal = input.diesOnSignal
    this.onExit = input.onExit
  }

  kill(signal?: NodeJS.Signals | number): boolean {
    // As Node answers for a process that already left: nothing is sent.
    if (this.exited) return false

    this.signals.push(signal)
    this.killed = true

    if (this.diesOnSignal || signal === 'SIGKILL') {
      const name = typeof signal === 'string' ? signal : 'SIGTERM'
      setImmediate(() => this.exit({code: null, signal: name}))
    }

    return true
  }

  // Ends the process the way the OS reports it: exit, streams closed, close.
  exit(how: FakeExit = {code: 0, signal: null}): void {
    if (this.exited) return

    this.exited = true
    this.exitCode = how.code
    this.signalCode = how.signal
    this.onExit()

    for (const stream of this.stdio) stream?.destroy()

    this.emit('exit', how.code, how.signal)
    this.emit('close', how.code, how.signal)
  }

  asChild(): ChildProcess {
    return this as unknown as ChildProcess
  }
}

type Teardown = {
  // Ends the fake at the end of a spec without it reading as a crash.
  retire: (child: FakeChild | undefined) => void
  terminate: (child: ChildProcess | null) => void
  terminatedByUs: (child: ChildProcess | null) => boolean
  terminated: FakeChild[]
}

// The real teardown runs taskkill on Windows, so the fake keeps its own
// record of who was asked to stop and only ever signals the fake child.
function fakeTeardown(): Teardown {
  const asked = new WeakSet<object>()
  const terminated: FakeChild[] = []

  return {
    terminated,
    retire(child) {
      if (!child) return

      asked.add(child)
      child.exit({code: null, signal: 'SIGKILL'})
    },
    terminate(child) {
      if (!child || child.killed) return

      asked.add(child)
      terminated.push(child as unknown as FakeChild)
      child.kill('SIGTERM')
    },
    terminatedByUs: (child) => Boolean(child && asked.has(child))
  }
}

function freeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const {port} = probe.address() as net.AddressInfo
      probe.close(() => resolve(port))
    })
  })
}

function closeServer(server: net.Server | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (!server?.listening) return resolve()

    server.close(() => resolve())
  })
}

export type FakeProject = {
  root: string
  project: string
  // The built extension a launch loads, with a manifest in it.
  out: string
  readyPath: string
  // A file that exists where a browser binary is expected. Never executed.
  plantBinary: (name?: string) => string
  writeManifest: (manifest: Record<string, unknown>) => void
  writeReady: (ready: Record<string, unknown>) => void
  readReady: () => Record<string, unknown>
  compilation: (mode?: 'development' | 'production') => {
    options: {mode: string; context: string; output: {path: string}}
    errors: unknown[]
  }
}

function createProject(root: string, browser: string): FakeProject {
  const project = path.join(root, 'project')
  const out = path.join(project, 'dist', browser)
  const readyPath = path.join(
    project,
    'dist',
    'extension-js',
    browser,
    'ready.json'
  )
  fs.mkdirSync(out, {recursive: true})

  const writeManifest = (manifest: Record<string, unknown>) =>
    fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest))

  writeManifest({manifest_version: 3, name: 'fake guest', version: '1.0.0'})

  return {
    root,
    project,
    out,
    readyPath,
    writeManifest,
    plantBinary(name = 'browser-stand-in') {
      const file = path.join(root, 'bin', name)
      fs.mkdirSync(path.dirname(file), {recursive: true})
      fs.writeFileSync(file, 'never executed: the fake browser stands in')
      fs.chmodSync(file, 0o755)

      return file
    },
    writeReady(ready) {
      fs.mkdirSync(path.dirname(readyPath), {recursive: true})
      fs.writeFileSync(readyPath, JSON.stringify(ready))
    },
    readReady: () => JSON.parse(fs.readFileSync(readyPath, 'utf-8')),
    compilation: (mode = 'production') => ({
      options: {mode, context: project, output: {path: out}},
      errors: []
    })
  }
}

// A temp root no installed browser lives under, with every variable that
// could point a launch at one cleared or moved inside it.
function sealedRoot(prefix: string): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)))

  for (const name of STEERING_VARIABLES) vi.stubEnv(name, undefined)

  vi.stubEnv('EXT_BROWSERS_CACHE_DIR', path.join(root, 'cache', 'browsers'))
  vi.stubEnv('HOME', root)
  vi.stubEnv('USERPROFILE', root)
  vi.stubEnv('LOCALAPPDATA', path.join(root, 'AppData', 'Local'))
  vi.stubEnv('XDG_CONFIG_HOME', path.join(root, 'config'))
  vi.stubEnv('XDG_CACHE_HOME', path.join(root, 'xdg-cache'))
  vi.stubEnv('EXTENSION_NO_INSTALL_PROMPT', '1')

  expect(process.env.EXT_BROWSERS_CACHE_DIR?.startsWith(root)).toBe(true)
  expect(process.env.HOME).toBe(root)

  return root
}

type Shared = {
  project: FakeProject
  // The port the fake browser answers on, free when the fake was made.
  port: number
  spawns: Array<{binary: string; args: string[]; stdio: unknown}>
  child: () => FakeChild | undefined
  located: string[]
  probed: string[]
  claims: Array<{requested: number; port: number; released: number}>
  claimDir: string
  // Claims the launcher's default claim function would take, for a spec that
  // needs the real claim files: same code, a folder of the fake's own.
  realClaim: (startPort: number) => Promise<DebugPortClaim>
  terminated: FakeChild[]
  signalWatchers: {registered: number; disposed: number}
  close: () => Promise<void>
}

export type FakeChromium = Shared & {
  deps: ChromiumLaunchDependencies
  // Every protocol command the browser received, in order.
  commands: Array<{method: string; params: unknown}>
  offeredInstalls: string[]
  // Replaces the answer to one protocol method. An `error` is a refusal.
  answer: (
    method: string,
    reply: (params: Record<string, unknown>) => unknown
  ) => void
}

export async function fakeChromium(
  options: {
    browser?: string
    script?: FakeBrowserScript
    // Where each system locator finds its browser. Left out, nowhere.
    installed?: Partial<Record<ChromiumLocatorName, string>>
    versionLine?: string
  } = {}
): Promise<FakeChromium> {
  const script = options.script ?? {}
  const root = sealedRoot('extjs-fake-chromium-')
  const project = createProject(root, options.browser ?? 'chrome')
  const port = await freeLoopbackPort()
  const claimDir = path.join(root, 'port-claims')
  const teardown = fakeTeardown()
  const spawns: Shared['spawns'] = []
  const located: string[] = []
  const probed: string[] = []
  const claims: Shared['claims'] = []
  const commands: FakeChromium['commands'] = []
  const offeredInstalls: string[] = []
  const signalWatchers = {registered: 0, disposed: 0}
  const timers = new Set<ReturnType<typeof setTimeout>>()
  let child: FakeChild | undefined
  let server: http.Server | undefined

  const targets = [{targetId: 'fake-page-1', type: 'page', url: 'about:blank'}]
  const answers = new Map<string, (params: Record<string, unknown>) => unknown>(
    [
      ['Target.getTargets', () => ({targetInfos: targets})],
      ['Extensions.loadUnpacked', () => ({id: 'a'.repeat(32)})],
      [
        'Browser.getVersion',
        () => ({product: 'Chrome/150.0.7871.24', userAgent: 'fake'})
      ]
    ]
  )

  const later = (ms: number, run: () => void) => {
    const timer = setTimeout(() => {
      timers.delete(timer)
      run()
    }, ms)
    timers.add(timer)
  }

  // NUL-delimited JSON, the framing of --remote-debugging-pipe.
  const servePipe = (fromClient: PassThrough, toClient: PassThrough) => {
    let pending = Buffer.alloc(0)

    fromClient.on('data', (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk])

      for (let end = pending.indexOf(0); end !== -1; end = pending.indexOf(0)) {
        const message = JSON.parse(pending.subarray(0, end).toString('utf-8'))
        pending = pending.subarray(end + 1)
        commands.push({method: message.method, params: message.params})

        if (script.handshake === 'silent') continue

        if (script.handshake === 'dies') {
          toClient.destroy()
          fromClient.destroy()

          return
        }

        const reply = answers.get(message.method)?.(message.params ?? {}) ?? {}
        const error = (reply as {error?: unknown}).error
        const frame = JSON.stringify(
          error
            ? {id: message.id, sessionId: message.sessionId, error}
            : {id: message.id, sessionId: message.sessionId, result: reply}
        )

        const send = () => {
          if (!toClient.destroyed) toClient.write(`${frame}\0`)
        }

        if (script.answerDelayMs) later(script.answerDelayMs, send)
        else send()
      }
    })
  }

  const listen = (debugPort: number) =>
    new Promise<void>((resolve, reject) => {
      server = http.createServer((request, response) => {
        const body =
          request.url === '/json/version'
            ? {Browser: 'Chrome/150.0.7871.24'}
            : targets.map((target) => ({
                id: target.targetId,
                type: target.type,
                url: target.url
              }))
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify(body))
      })

      server.once('error', reject)
      server.listen(debugPort, '127.0.0.1', () => resolve())
    })

  const locator = (name: ChromiumLocatorName) => () => {
    located.push(name)

    return options.installed?.[name] ?? null
  }

  const deps: ChromiumLaunchDependencies = {
    locate: {
      chrome: locator('chrome'),
      chromium: locator('chromium'),
      edge: locator('edge'),
      brave: locator('brave'),
      opera: locator('opera'),
      vivaldi: locator('vivaldi'),
      yandex: locator('yandex')
    },
    offerInstall: async (target) => {
      offeredInstalls.push(target)

      return false
    },
    probeVersion: async (binary) => {
      probed.push(binary)

      return options.versionLine ?? 'Google Chrome 150.0.7871.24'
    },
    claimPort: async (requested) => {
      const claim = {requested, port, released: 0}
      claims.push(claim)

      return {
        port,
        release: () => {
          claim.released += 1
        }
      }
    },
    spawn: async ({binary, launchArgs, stdio}) => {
      spawns.push({binary, args: launchArgs, stdio})

      if (script.spawnError) throw script.spawnError

      const wantsPipe = Array.isArray(stdio) && stdio.length === 5
      const streams = [
        null,
        null,
        new PassThrough(),
        ...(wantsPipe ? [new PassThrough(), new PassThrough()] : [])
      ]
      const spawned = new FakeChild({
        binary,
        args: launchArgs,
        streams,
        diesOnSignal: script.diesOnSignal ?? true,
        onExit: () => void closeServer(server)
      })
      child = spawned

      if (wantsPipe) {
        servePipe(streams[3] as PassThrough, streams[4] as PassThrough)
      }

      for (const line of script.stderr ?? []) streams[2]?.write(`${line}\n`)

      const portFlag = launchArgs.find((flag) =>
        flag.startsWith('--remote-debugging-port=')
      )

      if (portFlag && script.bindsPort !== false) {
        await listen(Number(portFlag.split('=')[1]))
      }

      if (script.exitsAfterMs !== undefined) {
        later(script.exitsAfterMs, () =>
          spawned.exit(script.exit ?? {code: 1, signal: null})
        )
      }

      return spawned.asChild()
    },
    watchSignals: () => {
      signalWatchers.registered += 1

      return () => {
        signalWatchers.disposed += 1
      }
    },
    // Loopback and timers only, so the production values are the fake's too.
    loadCdpSetup: chromiumLaunchDefaults.loadCdpSetup,
    sleep: chromiumLaunchDefaults.sleep,
    now: chromiumLaunchDefaults.now,
    terminate: teardown.terminate,
    terminatedByUs: teardown.terminatedByUs
  }

  return {
    deps,
    project,
    port,
    spawns,
    child: () => child,
    located,
    probed,
    claims,
    claimDir,
    realClaim: (startPort) => claimDebugPortNear(startPort, {dir: claimDir}),
    commands,
    offeredInstalls,
    terminated: teardown.terminated,
    signalWatchers,
    answer: (method, reply) => void answers.set(method, reply),
    async close() {
      for (const timer of timers) clearTimeout(timer)

      teardown.retire(child)
      await closeServer(server)
      vi.unstubAllEnvs()
      fs.rmSync(root, {recursive: true, force: true})
    }
  }
}

type RdpPacket = Record<string, unknown> & {type?: string; to?: string}

export type FakeFirefox = Shared & {
  deps: FirefoxLaunchDependencies
  // Every debugger packet the browser received, in order.
  packets: RdpPacket[]
  // One entry per connection the debugger port accepted, with how it went.
  dials: Array<NonNullable<FakeBrowserScript['handshake']>>
  terminatedPids: number[]
  exits: number[]
  // The process table the launcher reads to find a handed-off browser.
  processes: FirefoxLaunchDependencies['listProcesses'] extends () => infer R
    ? R
    : never
  alivePids: Set<number>
  // Replaces the answer to one packet type.
  answer: (type: string, reply: (packet: RdpPacket) => unknown) => void
}

export async function fakeFirefox(
  options: {
    browser?: string
    script?: FakeBrowserScript
    installed?: Partial<Record<GeckoLocatorName, string>>
    versionLine?: string
    librewolfRemoteDebugging?: boolean
  } = {}
): Promise<FakeFirefox> {
  const script = options.script ?? {}
  const root = sealedRoot('extjs-fake-firefox-')
  const project = createProject(root, options.browser ?? 'firefox')
  const port = await freeLoopbackPort()
  const claimDir = path.join(root, 'port-claims')
  const teardown = fakeTeardown()
  const spawns: Shared['spawns'] = []
  const located: string[] = []
  const probed: string[] = []
  const claims: Shared['claims'] = []
  const packets: RdpPacket[] = []
  const dials: FakeFirefox['dials'] = []
  const terminatedPids: number[] = []
  const exits: number[] = []
  const processes: FakeFirefox['processes'] = []
  const alivePids = new Set<number>()
  const signalWatchers = {registered: 0, disposed: 0}
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const sockets = new Set<net.Socket>()
  let child: FakeChild | undefined
  let server: net.Server | undefined

  const answers = new Map<string, (packet: RdpPacket) => unknown>([
    ['getRoot', () => ({from: 'root', addonsActor: 'addons1'})],
    [
      'installTemporaryAddon',
      () => ({
        from: 'addons1',
        addon: {id: 'fake-guest@extension.js', actor: 'addon1'}
      })
    ]
  ])

  const later = (ms: number, run: () => void) => {
    const timer = setTimeout(() => {
      timers.delete(timer)
      run()
    }, ms)
    timers.add(timer)
  }

  const closeRdp = async () => {
    for (const socket of sockets) socket.destroy()

    await closeServer(server)
  }

  const listen = (debugPort: number) =>
    new Promise<void>((resolve, reject) => {
      server = net.createServer((socket) => {
        sockets.add(socket)
        dials.push(script.handshake ?? 'answers')
        socket.on('error', () => {})
        socket.on('close', () => sockets.delete(socket))

        if (script.handshake === 'dies') {
          socket.destroy()

          return
        }

        const send = (packet: unknown) => {
          const write = () => {
            if (!socket.destroyed) socket.write(buildRdpFrame(packet))
          }

          if (script.answerDelayMs) later(script.answerDelayMs, write)
          else write()
        }

        if (script.handshake !== 'silent') {
          send({from: 'root', applicationType: 'browser'})
        }

        let incoming: Buffer = Buffer.alloc(0)

        socket.on('data', (chunk: Buffer) => {
          incoming = Buffer.concat([incoming, chunk])

          for (;;) {
            const {remainingData, parsedMessage} =
              parseRdpFrame<RdpPacket>(incoming)
            incoming = remainingData
            if (!parsedMessage) return

            packets.push(parsedMessage)
            if (script.handshake === 'silent') continue

            const answer = answers.get(String(parsedMessage.type))

            send(
              typeof answer === 'function'
                ? (answer(parsedMessage) ?? {from: parsedMessage.to})
                : {from: parsedMessage.to}
            )
          }
        })
      })

      server.once('error', reject)
      server.listen(debugPort, '127.0.0.1', () => resolve())
    })

  const locator = (name: GeckoLocatorName) => () => {
    located.push(name)

    return options.installed?.[name] ?? null
  }

  const deps: FirefoxLaunchDependencies = {
    locate: {
      firefox: locator('firefox'),
      waterfox: locator('waterfox'),
      librewolf: locator('librewolf'),
      zen: locator('zen'),
      floorp: locator('floorp')
    },
    librewolfRemoteDebugging: () => ({
      enabled: options.librewolfRemoteDebugging ?? true,
      expectedPath: path.join(root, '.librewolf', 'librewolf.overrides.cfg')
    }),
    probeVersion: async (binary) => {
      probed.push(binary)

      return options.versionLine ?? 'Mozilla Firefox 151.0'
    },
    claimPort: async (requested) => {
      const claim = {requested, port, released: 0}
      claims.push(claim)

      return {
        port,
        release: () => {
          claim.released += 1
        }
      }
    },
    spawn: async ({binary, args, stdio}) => {
      spawns.push({binary, args, stdio})

      if (script.spawnError) throw script.spawnError

      const streams = [null, new PassThrough(), new PassThrough()]
      const spawned = new FakeChild({
        binary,
        args,
        streams,
        diesOnSignal: script.diesOnSignal ?? true,
        onExit: () => void closeRdp()
      })
      child = spawned

      for (const line of script.stderr ?? []) streams[2]?.write(`${line}\n`)

      const at = args.indexOf('-start-debugger-server')

      if (at !== -1 && script.bindsPort !== false) {
        await listen(Number(args[at + 1]))
      }

      if (script.exitsAfterMs !== undefined) {
        later(script.exitsAfterMs, () =>
          spawned.exit(script.exit ?? {code: 1, signal: null})
        )
      }

      return spawned.asChild()
    },
    watchSignals: () => {
      signalWatchers.registered += 1

      return () => {
        signalWatchers.disposed += 1
      }
    },
    // Loopback and timers only, so the production values are the fake's too.
    awaitRdpPort: firefoxLaunchDefaults.awaitRdpPort,
    setupRdp: firefoxLaunchDefaults.setupRdp,
    terminate: teardown.terminate,
    terminatedByUs: teardown.terminatedByUs,
    terminatePid: (pid) => {
      if (pid) terminatedPids.push(pid)
    },
    pidTerminatedByUs: (pid) =>
      typeof pid === 'number' && terminatedPids.includes(pid),
    isPidAlive: (pid) => typeof pid === 'number' && alivePids.has(pid),
    pidStartId: () => undefined,
    listProcesses: () => processes,
    resolveLivePid: async (input) =>
      firefoxLaunchDefaults.resolveLivePid({
        ...input,
        list: () => processes,
        attempts: 1
      }),
    exit: (code) => {
      exits.push(code)
    }
  }

  return {
    deps,
    project,
    port,
    spawns,
    child: () => child,
    located,
    probed,
    claims,
    claimDir,
    realClaim: (startPort) => claimDebugPortNear(startPort, {dir: claimDir}),
    packets,
    dials,
    terminated: teardown.terminated,
    terminatedPids,
    exits,
    processes,
    alivePids,
    signalWatchers,
    answer: (type, reply) => void answers.set(type, reply),
    async close() {
      for (const timer of timers) clearTimeout(timer)

      teardown.retire(child)
      await closeRdp()
      vi.unstubAllEnvs()
      fs.rmSync(root, {recursive: true, force: true})
    }
  }
}
