import fs from 'node:fs'
import * as net from 'node:net'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {reservedHttpServer} from '../reserved-listen'
import {
  createBindFailureRelay,
  createStartFailure,
  releaseFailedStart,
  startBundler
} from '../start-bundler'
import {
  bootLoopback,
  createFixture,
  type LoopbackSession
} from './helpers/loopback-dev-server'

// The stock dev server asked to listen on a loopback port another socket
// holds, wired as the session wires it for a caller that keeps running.
const roots: string[] = []
const holders: net.Server[] = []

function hold(port: number): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const holder = net.createServer()
    holder.once('error', reject)
    holder.listen(port, '127.0.0.1', () => {
      holders.push(holder)
      resolve(holder)
    })
  })
}

afterEach(async () => {
  for (const holder of holders.splice(0)) {
    await new Promise<void>((resolve) => holder.close(() => resolve()))
  }

  for (const root of roots.splice(0)) {
    fs.rmSync(root, {recursive: true, force: true})
  }
})

describe('a dev server that cannot bind its port', () => {
  it('rejects the start with a coded error and leaves the process running', async () => {
    const root = createFixture('extjs-start-failure-')
    roots.push(root)
    const relay = createBindFailureRelay()
    const records: string[] = []
    const processExit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit')
    }) as never)
    const fail = createStartFailure({
      metadata: {writeError: (code) => records.push(code)},
      lifecycle: {
        failed: (message) => records.push(message),
        endWithoutFrame: () => records.push('ended without a frame'),
        sessionValue: () => ({})
      },
      exitOnError: false
    })
    let session: LoopbackSession | undefined
    let heldPort = 0
    let closedCompiler = false

    try {
      const rejection = await bootLoopback({
        root,
        beforeServer: (compiler) => {
          compiler.hooks.watchClose.tap('start-failure', () => {
            closedCompiler = true
          })
        },
        input: () => ({
          server: {
            type: reservedHttpServer({
              takeReservation: () => null,
              onBindError: (error) => relay.report(error)
            })
          }
        }),
        start: async (server, port) => {
          heldPort = port
          await hold(port)

          try {
            await startBundler(
              {start: () => relay.during(() => server.start())},
              {timeoutMs: 30000, onSlowStart: () => {}, onFailure: fail}
            )
          } catch (error) {
            await releaseFailedStart({
              server,
              releasePort: async () => {},
              closeControlBridge: async () => {}
            })

            throw error
          }
        }
      }).then(
        (booted) => {
          session = booted

          return null
        },
        (error: unknown) => error
      )

      expect(rejection).toBeInstanceOf(Error)
      expect(rejection).toMatchObject({code: 'E_DEV_SERVER_START'})

      const {message, cause} = rejection as Error & {
        cause: {code: string; message: string}
      }

      expect(cause.code).toBe('EADDRINUSE')
      expect(message).toContain('EADDRINUSE')
      expect(message).toContain(String(heldPort))
      // eslint-disable-next-line no-control-regex
      expect(message).not.toMatch(/\u001b|⏵/)
      // The caller frames the rejection, so the engine writes no frame.
      expect(records).toEqual([
        'dev_server_start_failed',
        'ended without a frame'
      ])

      expect(processExit).not.toHaveBeenCalled()
      expect(closedCompiler).toBe(true)

      // The port is still the other socket's, and ours left nothing on it.
      expect(holders[0]?.listening).toBe(true)
    } finally {
      processExit.mockRestore()
      await session?.server.stop()
    }
  })
})
