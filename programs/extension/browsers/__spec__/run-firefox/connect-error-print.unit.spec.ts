import net from 'node:net'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {RemoteFirefox} from '../../run-firefox/rdp/remote-firefox'

let server: net.Server
let port = 0
let printed: () => string
let previousDebug: string | undefined

beforeEach(async () => {
  server = net.createServer((socket) => socket.destroy()).listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  port = (server.address() as net.AddressInfo).port

  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  printed = () =>
    errors.mock.calls.map((call) => call.map(String).join(' ')).join('\n')

  previousDebug = process.env.EXTENSION_DEBUG
  Reflect.deleteProperty(process.env, 'EXTENSION_DEBUG')
})

afterEach(async () => {
  vi.restoreAllMocks()

  if (previousDebug === undefined) {
    Reflect.deleteProperty(process.env, 'EXTENSION_DEBUG')
  } else {
    process.env.EXTENSION_DEBUG = previousDebug
  }

  await new Promise((resolve) => server.close(() => resolve(undefined)))
})

function connect() {
  const remote = new RemoteFirefox({
    extension: '/nowhere/dist',
    browser: 'firefox'
  } as never)

  return (
    remote as unknown as {connectClient: (p: number) => Promise<unknown>}
  ).connectClient(port)
}

describe('a debugger socket that dies on connect', () => {
  it('is reported as one block with the reason and no stack trace', async () => {
    await expect(connect()).rejects.toThrow(/closed unexpectedly/)

    const output = printed()
    expect(output).toMatch(/hit an unexpected error/)
    expect(output).toMatch(/closed unexpectedly/)
    expect(output).not.toMatch(/\n\s+at /)
    expect(output.match(/closed unexpectedly/g)).toHaveLength(1)
  })

  it('keeps the stack under EXTENSION_DEBUG', async () => {
    process.env.EXTENSION_DEBUG = 'true'

    await expect(connect()).rejects.toThrow(/closed unexpectedly/)

    expect(printed()).toMatch(/\n\s+at /)
  })
})
