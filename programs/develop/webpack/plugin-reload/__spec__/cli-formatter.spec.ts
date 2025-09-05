import {beforeEach, describe, expect, it, vi} from 'vitest'

// Minimal FakeWS similar to handshake test
class FakeWS {
  public handlers: Record<string, Function[]> = {}
  on = (event: string, cb: any) => {
    this.handlers[event] = this.handlers[event] || []
    this.handlers[event].push(cb)
  }
  send = vi.fn()
  close = vi.fn()
}

let connectionHandler: ((ws: any) => void) | null = null

vi.mock('ws', () => {
  return {
    WebSocketServer: class {
      constructor(_: any) {}
      on(event: string, cb: any) {
        if (event === 'connection') connectionHandler = cb
      }
      close = vi.fn()
    },
    WebSocket: class {}
  }
})

// Mock InstanceManager to provide instance and ports
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
    }
  }
})

// Mock fs read for manifest
vi.mock('fs', async () => {
  const actual = await vi.importActual<any>('fs')
  return {
    ...actual,
    readFileSync: vi.fn((p: string) => {
      if (String(p).endsWith('manifest.json')) {
        return JSON.stringify({name: 'X', version: '1.0.0'})
      }
      return actual.readFileSync(p)
    })
  }
})

import {startServer} from '../start-server'

function makeCompiler(): any {
  return {
    options: {context: process.cwd(), output: {path: '/tmp/out/chrome'}},
    hooks: {} as any
  }
}

describe('CLI formatter', () => {
  const logs: string[] = []
  beforeEach(() => {
    connectionHandler = null
    logs.length = 0
    vi.spyOn(console, 'log').mockImplementation((s?: any) => {
      logs.push(String(s ?? ''))
    })
  })

  it('omits #tabId for background/manager and cleans null parts', async () => {
    const compiler = makeCompiler()
    ;(compiler.options as any).currentInstance = {instanceId: 'expected1234'}
    await startServer(compiler, {browser: 'chrome'} as any)
    const ws = new FakeWS()
    connectionHandler!(ws)

    const evt: any = {
      level: 'info',
      context: 'background',
      timestamp: Date.now(),
      url: 'chrome://extensions',
      incognito: false,
      tabId: 123,
      messageParts: ['extension installed', 'install', null, '']
    }
    const msg = {
      status: 'log',
      instanceId: 'expected1234',
      data: evt
    }
    const handler = ws.handlers['message']?.[0]
    handler!(Buffer.from(JSON.stringify(msg)))

    const out = logs.join('\n')
    expect(out).toMatch(/background /)
    expect(out).not.toMatch(/#123/)
    expect(out).toMatch(/extension installed install \(unknown\)/)
  })
})
