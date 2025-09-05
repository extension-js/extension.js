import {beforeEach, describe, expect, it, vi} from 'vitest'
import {type Compiler} from '@rspack/core'

// Capture logs
const logs: string[] = []
const origLog = console.log

// Mock ws server with controllable connection
class FakeWS {
  public handlers: Record<string, Function[]> = {}
  public closed: {code?: number; reason?: string} | null = null
  send = vi.fn()
  on = (event: string, cb: any) => {
    this.handlers[event] = this.handlers[event] || []
    this.handlers[event].push(cb)
  }
  close = (code?: number, reason?: string) => {
    this.closed = {code, reason}
  }
}

let connectionHandler: ((ws: any) => void) | null = null

vi.mock('ws', () => {
  return {
    WebSocketServer: class {
      clients = new Set()
      constructor(_: any) {}
      on(event: string, cb: any) {
        if (event === 'connection') connectionHandler = cb
      }
      close = vi.fn()
    },
    WebSocket: class {}
  }
})

// Mock filesystem reads for manifest
vi.mock('fs', async () => {
  const actual = await vi.importActual<any>('fs')
  return {
    ...actual,
    readFileSync: vi.fn((p: string) => {
      if (String(p).endsWith('manifest.json')) {
        return JSON.stringify({name: 'TestExtension', version: '1.0.0'})
      }
      return actual.readFileSync(p)
    })
  }
})

// Mock InstanceManager to return a deterministic instance
vi.mock('../../plugin-browsers/browsers-lib/instance-manager', () => {
  return {
    InstanceManager: class {
      constructor(_: any) {}
      async getInstance() {
        return {
          instanceId: 'expected1234',
          webSocketPort: 9123,
          port: 8081,
          browser: 'chrome',
          managerExtensionId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          projectPath: process.cwd(),
          processId: process.pid,
          startTime: Date.now(),
          status: 'running'
        }
      }
      async updateInstance() {}
    }
  }
})

// Import under test after mocks
import {startServer} from '../start-server'

function makeCompiler(): Compiler {
  return {
    options: {
      context: process.cwd(),
      output: {path: '/tmp/out/chrome'}
    },
    hooks: {} as any
  } as any
}

describe('start-server handshake', () => {
  beforeEach(() => {
    connectionHandler = null
    logs.length = 0
    vi.spyOn(console, 'log').mockImplementation((msg?: any) => {
      logs.push(String(msg ?? ''))
    })
  })

  it('prints runningInDevelopment on clientReady for correct instance', async () => {
    const compiler = makeCompiler()
    ;(compiler.options as any).currentInstance = {instanceId: 'expected1234'}

    // Start server (will set up connection handler)
    await startServer(compiler as any, {browser: 'chrome'} as any)
    expect(connectionHandler).toBeTypeOf('function')

    // Simulate a connection and clientReady
    const ws = new FakeWS()
    connectionHandler!(ws)

    // Emit message with correct instanceId and management payload
    const message = {
      status: 'clientReady',
      instanceId: 'expected1234',
      data: {
        id: 'extid123',
        management: {name: 'TestExtension', version: '1.0.0'}
      }
    }
    // Find the 'message' handler and invoke it
    const msgHandler = ws.handlers['message']?.[0]
    expect(msgHandler).toBeTypeOf('function')
    msgHandler!(Buffer.from(JSON.stringify(message)))

    // Assert summary printed
    const joined = logs.join('\n')
    expect(joined).toMatch(/Extension Name\s+TestExtension/)
    expect(joined).toMatch(/Extension Version\s+1.0.0/)
    expect(joined).toMatch(/Extension ID\s+extid123/)
  })

  it('closes wrong-instance connection with 1008 and logs warning', async () => {
    const compiler = makeCompiler()
    ;(compiler.options as any).currentInstance = {instanceId: 'expected1234'}

    await startServer(compiler as any, {browser: 'chrome'} as any)
    const ws = new FakeWS()
    connectionHandler!(ws)

    const wrong = {
      status: 'clientReady',
      instanceId: 'WRONG9999',
      data: {id: 'x', management: {name: 'X', version: '0.0.0'}}
    }
    const msgHandler = ws.handlers['message']?.[0]
    msgHandler!(Buffer.from(JSON.stringify(wrong)))

    const joined = logs.join('\n')
    expect(joined).toMatch(/Ignoring message from wrong instance/)
    expect(ws.closed?.code).toBe(1008)
  })

  it('prints clientReadyTimeoutSummary when handshake does not arrive', async () => {
    process.env.EXTENSION_ENV = 'development'
    const compiler = makeCompiler()
    ;(compiler.options as any).currentInstance = {instanceId: 'expected1234'}

    // Shorten watchdog via env (simulate by overriding setTimeout)
    const realSetTimeout = global.setTimeout
    const timers: Function[] = []
    // Intercept timeouts; immediately run them to simulate expiry
    // Only for this test scope
    // @ts-ignore
    global.setTimeout = ((cb: any) => {
      timers.push(cb)
      return 0 as any
    }) as any

    await startServer(compiler as any, {browser: 'chrome'} as any)
    const ws = new FakeWS()
    connectionHandler!(ws)

    // Trigger the queued watchdog callback to simulate timeout
    for (const cb of timers) cb()

    const joined = logs.join('\n')
    expect(joined).toMatch(/Client readiness not confirmed/)
    expect(joined).toMatch(/expected instance/)

    // restore
    // @ts-ignore
    global.setTimeout = realSetTimeout
  })
})
