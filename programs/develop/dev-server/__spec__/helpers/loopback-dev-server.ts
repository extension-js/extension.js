import fs from 'node:fs'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import {type Compiler, rspack, type Stats} from '@rspack/core'
import {type Configuration, RspackDevServer} from '@rspack/dev-server'
import {WebSocket} from 'ws'
import {buildServerConfig, type ServerConfigInput} from '../../server-config'

// A bare rspack compiler on a fixture in a temp folder, served by the stock
// dev server with this folder's real config. No compiled dist, loopback only.

// The reload socket path a session names, the one its extension dials.
export const LOOPBACK_SOCKET_PATH = '/ws/loopback-session'

export interface LoopbackSession {
  root: string
  distPath: string
  publicFolder: string
  compiler: Compiler
  server: RspackDevServer
  port: number
  compiles: () => number
  firstCompile: Promise<Stats>
  config: Configuration
}

export async function freeLoopbackPort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      const port = typeof address === 'object' && address ? address.port : 0
      probe.close(() => resolve(port))
    })
  })
}

export function createFixture(prefix: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  fs.mkdirSync(path.join(root, 'src'), {recursive: true})
  fs.mkdirSync(path.join(root, 'public'), {recursive: true})
  fs.writeFileSync(path.join(root, 'src', 'index.js'), 'export const a = 1\n')
  fs.writeFileSync(path.join(root, 'public', 'data.txt'), 'one\n')

  return root
}

export async function bootLoopback(options: {
  root: string
  beforeServer?: (compiler: Compiler, distPath: string) => void
  input?: (port: number) => Partial<ServerConfigInput>
  start?: (server: RspackDevServer, port: number) => Promise<void>
  mutateConfig?: (config: Configuration) => Configuration
}): Promise<LoopbackSession> {
  const {root} = options
  const distPath = path.join(root, 'dist', 'chrome')
  const publicFolder = path.join(root, 'public')
  const port = await freeLoopbackPort()
  const compiler = rspack({
    mode: 'development',
    context: root,
    entry: {background: path.join(root, 'src', 'index.js')},
    output: {path: distPath, clean: false},
    devtool: false,
    stats: 'none',
    infrastructureLogging: {level: 'none'},
    plugins: [
      {
        apply(c: Compiler) {
          c.hooks.thisCompilation.tap('fixture-manifest', (compilation) => {
            compilation.hooks.processAssets.tap('fixture-manifest', () => {
              compilation.emitAsset(
                'manifest.json',
                new c.webpack.sources.RawSource('{"manifest_version":3}')
              )
            })
          })
        }
      }
    ]
  })
  let compiles = 0
  const firstCompile = new Promise<Stats>((resolve) => {
    compiler.hooks.done.tap('loopback-count', (stats) => {
      compiles++
      if (compiles === 1) resolve(stats)
    })
  })

  options.beforeServer?.(compiler, distPath)

  const config = buildServerConfig({
    host: '127.0.0.1',
    port,
    connectableHost: '127.0.0.1',
    emulatorOrigin: null,
    isSessionExtensionOrigin: () => false,
    publicFolder,
    emulatorFiles: null,
    activeCompiler: () => compiler,
    onHostRefused: () => {},
    onSiteRefused: () => {},
    server: undefined,
    socketPath: LOOPBACK_SOCKET_PATH,
    ...options.input?.(port)
  })
  const finalConfig = options.mutateConfig
    ? options.mutateConfig(config)
    : config
  const server = new RspackDevServer(finalConfig, compiler)

  await (options.start ? options.start(server, port) : server.start())

  return {
    root,
    distPath,
    publicFolder,
    compiler,
    server,
    port,
    compiles: () => compiles,
    firstCompile,
    config: finalConfig
  }
}

export async function connectClient(
  port: number,
  origin: string | null = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop',
  socketPath = LOOPBACK_SOCKET_PATH
) {
  const messages: Array<{type: string; data?: unknown}> = []
  // The stock server closes a socket with no Origin; extension pages send theirs.
  // It never answers an upgrade at a path it does not serve, hence the bound.
  const socket = new WebSocket(`ws://127.0.0.1:${port}${socketPath}`, {
    handshakeTimeout: 2000,
    ...(origin === null ? {} : {origin})
  })

  socket.on('message', (raw) => {
    try {
      messages.push(JSON.parse(String(raw)))
    } catch {
      // Not a frame this test reads.
    }
  })

  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve())
    socket.once('error', reject)
  })

  return {socket, messages}
}

export async function waitFor(
  check: () => boolean,
  timeoutMs: number,
  stepMs = 50
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    if (check()) return true

    await new Promise((resolve) => setTimeout(resolve, stepMs))
  }

  return check()
}

export async function closeSocket(socket: WebSocket | undefined) {
  if (!socket) return
  if (socket.readyState === WebSocket.CLOSED) return

  await new Promise<void>((resolve) => {
    socket.once('close', () => resolve())
    socket.terminate()
  })
}
