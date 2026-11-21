import * as fs from 'node:fs'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {sessionOf} from '../../__spec__/helpers/dev-session'
import {controlPortFilePath} from '../../lib/session-paths'
import {stripAnsi} from '../../lib/strip-ansi'
import {
  createReadyContractWriter,
  ReadyContractPlugin
} from '../../plugin-ready-contract'
import type {BridgeBroker} from '../control-bridge/broker'
import {CONTROL_WS_PATH} from '../control-bridge/contracts'
import type {ControlServer} from '../control-bridge/ws-control-server'
import {controlCoordinatesOf, openControlBridge} from '../control-bridge-start'

const roots: string[] = []
const closers: Array<() => Promise<void>> = []

afterEach(async () => {
  while (closers.length) await closers.pop()?.()

  for (const root of roots.splice(0)) {
    fs.rmSync(root, {recursive: true, force: true})
  }
})

function project(persistedPort?: number) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-bridge-'))
  roots.push(root)
  fs.writeFileSync(path.join(root, 'package.json'), '{}', 'utf-8')

  if (persistedPort != null) {
    fs.mkdirSync(path.join(root, '.extension-js'), {recursive: true})
    fs.writeFileSync(
      controlPortFilePath(root, 'chrome'),
      `${persistedPort}\n`,
      'utf-8'
    )
  }

  return root
}

function fakes() {
  const broker = {
    noteControlPortUnavailable: vi.fn(),
    pingProducers: () => {},
    onFrame: () => {},
    onClose: () => {}
  }
  const logFile = {start: vi.fn(), close: vi.fn()}
  const actionsFile = {start: vi.fn()}

  return {broker, logFile, actionsFile}
}

async function bindLoopback(): Promise<{
  port: number
  close: () => Promise<void>
}> {
  const server = net.createServer()

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0

  return {
    port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

describe('opening the control bridge', () => {
  it('reports a control port that cannot bind instead of swallowing it', async () => {
    const root = project(50111)
    const {broker, logFile, actionsFile} = fakes()
    const printed: string[] = []
    const startServer = vi.fn(async (options: {port?: number}) => {
      throw new Error(
        options.port
          ? 'listen EADDRINUSE 127.0.0.1:50111'
          : 'listen EADDRNOTAVAIL 10.0.0.9:0'
      )
    })

    const opening = await openControlBridge({
      broker: broker as unknown as BridgeBroker,
      host: '127.0.0.1',
      viewerOrigin: null,
      packageJsonDir: root,
      browserName: 'chrome',
      logFile,
      actionsFile,
      print: (line) => printed.push(stripAnsi(line)),
      startServer: startServer
    })

    // Both the preferred-port call and the ephemeral fallback must have run.
    expect(startServer).toHaveBeenCalledTimes(2)
    expect(startServer.mock.calls[0]?.[0]).toMatchObject({port: 50111})
    expect(startServer.mock.calls[1]?.[0]?.port).toBeUndefined()
    expect(opening).toEqual({
      controlPort: null,
      unavailableReason: 'listen EADDRNOTAVAIL 10.0.0.9:0',
      close: expect.any(Function)
    })

    expect(broker.noteControlPortUnavailable.mock.calls).toEqual([
      ['listen EADDRNOTAVAIL 10.0.0.9:0']
    ])

    expect(logFile.start).toHaveBeenCalledTimes(1)
    expect(actionsFile.start).toHaveBeenCalledTimes(1)
    expect(logFile.close).toHaveBeenCalledTimes(1)
    expect(printed).toHaveLength(1)
    expect(printed[0]).toContain("couldn't open the control port")
    expect(printed[0]).toContain('listen EADDRNOTAVAIL 10.0.0.9:0')
    expect(printed[0]).toContain('nothing reloads in the browser')
  })

  it('hands the bind failure to both writers of the session contract', async () => {
    const root = project()
    const {broker, logFile, actionsFile} = fakes()
    const opening = await openControlBridge({
      broker: broker as unknown as BridgeBroker,
      host: '127.0.0.1',
      viewerOrigin: null,
      packageJsonDir: root,
      browserName: 'chrome',
      logFile,
      actionsFile,
      print: () => {},
      startServer: async () => {
        throw new Error('listen EADDRNOTAVAIL 10.0.0.9:0')
      }
    })
    const coordinates = controlCoordinatesOf(opening)
    const contract = () =>
      JSON.parse(
        fs.readFileSync(
          path.join(root, 'dist', 'extension-js', 'chrome', 'ready.json'),
          'utf8'
        )
      )
    const refused = {
      controlPort: null,
      controlPortUnavailableReason: 'listen EADDRNOTAVAIL 10.0.0.9:0'
    }
    const session = {
      packageJsonDir: root,
      browser: 'chrome',
      manifestPath: path.join(root, 'manifest.json'),
      port: 8080
    }

    expect(coordinates).toEqual({...refused, controlPath: CONTROL_WS_PATH})

    // The session's own writer, which stamps what no compile does.
    createReadyContractWriter({
      ...session,
      ...coordinates,
      command: 'dev',
      distPath: path.join(root, 'dist', 'chrome')
    }).writeStarting()

    expect(contract()).toMatchObject(refused)

    fs.rmSync(path.join(root, 'dist'), {recursive: true, force: true})

    // The compiler's writer, built from the options the bundler config reads.
    const anyHook = new Proxy(
      {},
      {get: () => ({tap: () => {}, tapPromise: () => {}, tapAsync: () => {}})}
    )

    new ReadyContractPlugin({
      packageJsonDir: root,
      browser: 'chrome',
      manifestPath: path.join(root, 'manifest.json'),
      session: sessionOf({port: 8080, controlPort: coordinates.controlPort}),
      controlPortUnavailableReason: coordinates.controlPortUnavailableReason,
      controlPath: coordinates.controlPath,
      mode: 'development',
      outputPath: path.join(root, 'dist', 'chrome')
    }).apply({hooks: anyHook} as never)

    expect(contract()).toMatchObject(refused)
  })

  it('does not retry when no port was persisted', async () => {
    const root = project()
    const {broker, logFile} = fakes()
    const startServer = vi.fn(async () => {
      throw new Error('listen EACCES 127.0.0.1:0')
    })

    const opening = await openControlBridge({
      broker: broker as unknown as BridgeBroker,
      host: '127.0.0.1',
      viewerOrigin: null,
      packageJsonDir: root,
      browserName: 'chrome',
      logFile,
      print: () => {},
      startServer: startServer
    })

    expect(startServer.mock.calls).toEqual([
      [{broker, host: '127.0.0.1', port: 0, viewerOrigin: null}]
    ])

    expect(opening).toEqual({
      controlPort: null,
      unavailableReason: 'listen EACCES 127.0.0.1:0',
      close: expect.any(Function)
    })
  })

  it('falls back to a free port when the persisted one is taken on loopback', async () => {
    const taken = await bindLoopback()
    closers.push(taken.close)
    const root = project(taken.port)
    const {broker, logFile} = fakes()
    const servers: ControlServer[] = []
    const {startControlServer} = await import(
      '../control-bridge/ws-control-server'
    )

    const startServer = async (
      options: Parameters<typeof startControlServer>[0]
    ) => {
      const server = await startControlServer(options)
      servers.push(server)
      closers.push(() => server.close())

      return server
    }

    const opening = await openControlBridge({
      broker: broker as unknown as BridgeBroker,
      host: '127.0.0.1',
      viewerOrigin: null,
      packageJsonDir: root,
      browserName: 'chrome',
      logFile,
      print: () => {},
      startServer
    })

    expect(servers).toHaveLength(1)
    expect(opening.unavailableReason).toBeNull()
    expect(opening.controlPort).toBe(servers[0]?.port)
    expect(opening.controlPort).not.toBe(taken.port)
    expect(
      fs.readFileSync(controlPortFilePath(root, 'chrome'), 'utf-8').trim()
    ).toBe(String(opening.controlPort))

    expect(broker.noteControlPortUnavailable).not.toHaveBeenCalled()
    expect(logFile.close).not.toHaveBeenCalled()
  })

  async function controlSocket() {
    const frames: unknown[] = []
    const closes: unknown[] = []
    const broker = {
      pingProducers: () => {},
      onFrame: (_conn: unknown, frame: unknown) => frames.push(frame),
      onClose: (conn: unknown) => closes.push(conn)
    }
    const {startControlServer, MAX_CONTROL_FRAME_BYTES} = await import(
      '../control-bridge/ws-control-server'
    )
    const {WebSocket} = await import('ws')
    const server = await startControlServer({
      broker: broker as unknown as BridgeBroker,
      host: '127.0.0.1',
      port: 0
    })
    closers.push(() => server.close())
    const socket = new WebSocket(
      `ws://127.0.0.1:${server.port}${CONTROL_WS_PATH}`
    )
    const closed = new Promise<number>((resolve) => {
      socket.once('close', (code) => resolve(code))
    })
    closers.push(async () => {
      socket.terminate()
      await closed
    })

    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve())
      socket.once('error', reject)
    })

    // The server ends the socket mid-send, which the client reports here.
    socket.on('error', () => {})

    return {
      frames,
      closes,
      socket,
      closed,
      limit: MAX_CONTROL_FRAME_BYTES,
      WebSocket
    }
  }

  it('takes a frame far above what a producer sends', async () => {
    const {frames, socket, WebSocket} = await controlSocket()
    const payload = 'x'.repeat(1024 * 1024)
    socket.send(JSON.stringify({type: 'pin', payload}))

    await vi.waitFor(() => expect(frames).toHaveLength(1), {timeout: 10000})
    expect((frames[0] as {payload: string}).payload.length).toBe(payload.length)
    expect(socket.readyState).toBe(WebSocket.OPEN)
  })

  it('closes a socket that sends a frame above the limit and keeps serving', async () => {
    const savedDebug = process.env.EXTENSION_DEBUG
    process.env.EXTENSION_DEBUG = '1'
    const debug = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      const {frames, closes, socket, closed, limit} = await controlSocket()
      socket.send(JSON.stringify({type: 'pin', payload: 'x'.repeat(limit)}))

      // 1009 is the WebSocket close code for a message that is too big.
      expect(await closed).toBe(1009)
      expect(frames).toEqual([])

      // The error and the close that follows reach the broker as one end.
      await vi.waitFor(() => expect(closes).toHaveLength(1))
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(closes).toHaveLength(1)

      const lines = debug.mock.calls.map((call) => stripAnsi(String(call[0])))
      expect(lines.filter((line) => line.includes('control'))).toEqual([
        expect.stringContaining(`a frame above ${limit} bytes`)
      ])
    } finally {
      debug.mockRestore()

      if (savedDebug === undefined) {
        Reflect.deleteProperty(process.env, 'EXTENSION_DEBUG')
      } else process.env.EXTENSION_DEBUG = savedDebug
    }

    const next = await controlSocket()
    next.socket.send(JSON.stringify({type: 'pin', payload: 'small'}))
    await vi.waitFor(() => expect(next.frames).toHaveLength(1))
  })
})
