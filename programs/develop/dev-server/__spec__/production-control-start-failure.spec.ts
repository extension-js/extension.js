import * as fs from 'node:fs'
import * as net from 'node:net'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {trackTempFolders} from '../../__spec__/helpers/temp-folders'
import {ActionsFileWriter} from '../control-bridge/actions-file'
import {LogsFileWriter} from '../control-bridge/logs-file'
import {startProductionControl} from '../control-bridge/production-control'
import {readControlToken} from '../control-bridge/session-token'

const tempFolder = trackTempFolders()

interface OpenedServer {
  server: net.Server
  port: number
}

// Every server the function opens, with the port it was given while it held it.
let opened: OpenedServer[] = []

function canListen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer()

    probe.once('error', () => resolve(false))
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)))
  })
}

function closeServer(server: net.Server): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) return resolve()

    server.close(() => resolve())
  })
}

// A project whose build step cannot finish, each for a reason of its own.
const BROKEN_BUILDS: Array<{
  reason: string
  make: (root: string) => string
  error: {name: string; code: string | undefined; message: RegExp}
}> = [
  {
    reason: 'the build folder is missing',
    make: (root) => path.join(root, 'dist', 'chrome'),
    error: {name: 'Error', code: 'ENOENT', message: /ENOENT.*dist/}
  },
  {
    reason: 'the built manifest.json is not JSON',
    make: (root) => {
      const distPath = path.join(root, 'dist', 'chrome')

      fs.mkdirSync(distPath, {recursive: true})
      fs.writeFileSync(path.join(distPath, 'manifest.json'), '{"name": ')

      return distPath
    },
    error: {name: 'SyntaxError', code: undefined, message: /JSON/}
  }
]

function project(make: (root: string) => string) {
  const root = tempFolder('extjs-production-control-failure-')

  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"x"}')

  return {root, distPath: make(root)}
}

async function startAndCatch(root: string, distPath: string) {
  try {
    const session = await startProductionControl({
      packageJsonDir: root,
      browser: 'chrome',
      distPath,
      allowControl: true,
      allowEval: true
    })

    await session.close()

    return undefined
  } catch (error) {
    return error as Error & {code?: string; cause?: unknown}
  }
}

beforeEach(() => {
  opened = []

  const listen = net.Server.prototype.listen

  // Not a stand-in: the real listen runs, this only notes who was listening.
  vi.spyOn(net.Server.prototype, 'listen').mockImplementation(function (
    this: net.Server,
    ...args: unknown[]
  ) {
    this.once('listening', () => {
      const address = this.address()

      if (address && typeof address === 'object') {
        opened.push({server: this, port: address.port})
      }
    })

    return (listen as (...rest: unknown[]) => net.Server).apply(this, args)
  })

  vi.spyOn(LogsFileWriter.prototype, 'close')
  vi.spyOn(ActionsFileWriter.prototype, 'close')
})

afterEach(async () => {
  vi.restoreAllMocks()

  // A server the function left open would keep this process from exiting.
  for (const {server} of opened) await closeServer(server)
})

describe('startProductionControl when the build step throws', () => {
  it.each(
    BROKEN_BUILDS
  )('rejects with the error of the build step when $reason', async ({
    make,
    error
  }) => {
    const {root, distPath} = project(make)
    const thrown = await startAndCatch(root, distPath)

    expect(thrown).toBeInstanceOf(Error)
    expect(thrown?.name).toBe(error.name)
    expect(thrown?.code).toBe(error.code)
    expect(thrown?.message).toMatch(error.message)
    expect(thrown?.cause).toBeUndefined()
    // The throw came after the listen, which is the case under test.
    expect(opened).toHaveLength(1)
    expect(opened[0].port).toBeGreaterThan(0)
  })

  // Fails today: the server keeps listening and no writer is closed. Drop
  // `.fails` with the fix, the assertions below are the behavior to reach.
  it.fails.each(
    BROKEN_BUILDS
  )('closes its server and writers when $reason', async ({make}) => {
    const {root, distPath} = project(make)
    const exitListeners = process.listenerCount('exit')

    await startAndCatch(root, distPath)

    expect(opened).toHaveLength(1)
    expect(opened[0].server.listening).toBe(false)
    expect(await canListen(opened[0].port)).toBe(true)
    expect(LogsFileWriter.prototype.close).toHaveBeenCalledTimes(1)
    expect(ActionsFileWriter.prototype.close).toHaveBeenCalledTimes(1)
    expect(readControlToken(root, 'chrome')).toBeNull()
    expect(process.listenerCount('exit')).toBe(exitListeners)
  })
})
