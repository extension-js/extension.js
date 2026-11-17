import {type ChildProcess, spawn} from 'node:child_process'
import {once} from 'node:events'
import * as http from 'node:http'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {openSafariWebDriverSession} from '../../run-safari/safari-launch/webdriver'
import {type FakeSafariTools, fakeSafariTools} from '../safari-fake-tools'

const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP', 'exit'] as const
const REFUSAL = 'Could not create a session: refused by the test'

// A safaridriver that is up and refuses the session, served in this process.
function refusingDriver(port: number): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      req.resume()
      req.on('end', () => {
        const ready = req.method === 'GET' && req.url === '/status'
        res.writeHead(ready ? 200 : 500, {'Content-Type': 'application/json'})
        res.end(
          JSON.stringify({
            value: ready
              ? {ready: true}
              : {error: 'session not created', message: REFUSAL}
          })
        )
      })
    })
    server.listen(port, '127.0.0.1', () => resolve(server))
  })
}

// The process list is scripted and the signal is a fake: a real automation
// Safari may be running on this machine and is never read or reached.
describe('the automation Safari a session quits on its way out', () => {
  let bystander: ChildProcess
  let servers: http.Server[]
  let listenersBefore: Map<string, unknown[]>
  let tools: FakeSafariTools

  beforeEach(async () => {
    servers = []
    listenersBefore = new Map(
      SIGNALS.map((name) => [name, process.listeners(name as 'exit')])
    )

    // Its pid stands in for the foreign Safari, so nothing else can be hit.
    bystander = spawn(
      process.execPath,
      ['-e', 'setInterval(() => {}, 1000)', 'extjs-spec-bystander'],
      {stdio: 'ignore'}
    )

    await once(bystander, 'spawn')

    let listings = 0
    tools = fakeSafariTools()
    // Absent when the session takes its snapshot, there when it stops.
    tools.listAutomationPids = async () =>
      listings++ === 0 ? [] : [bystander.pid as number]

    tools.startWebDriver = async (port) => {
      const server = await refusingDriver(port)
      servers.push(server)

      return {ok: true, output: '', stop: () => server.closeAllConnections()}
    }
  })

  afterEach(async () => {
    vi.useRealTimers()
    vi.restoreAllMocks()

    for (const name of SIGNALS) {
      for (const listener of process.listeners(name as 'exit')) {
        if (!listenersBefore.get(name)?.includes(listener)) {
          process.removeListener(name, listener)
        }
      }
    }

    for (const server of servers) {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }

    const exited = once(bystander, 'exit')
    process.kill(bystander.pid as number, 'SIGKILL')
    await exited
  })

  function fakeKill(probeCode: 'ESRCH' | 'EPERM') {
    return vi.spyOn(process, 'kill').mockImplementation((_pid, signal) => {
      if (signal === 'SIGTERM') return true

      throw Object.assign(new Error(`kill ${probeCode}`), {code: probeCode})
    })
  }

  // Pins today's behavior. Ledger 1374 D15.
  it('signals an automation Safari that appeared since its snapshot, whoever raised it', async () => {
    const kill = fakeKill('ESRCH')

    const outcome = await openSafariWebDriverSession(tools, {attempts: 1})

    expect(outcome).toEqual({reason: REFUSAL})
    expect(servers).toHaveLength(1)
    expect(kill.mock.calls).toEqual([
      [bystander.pid, 'SIGTERM'],
      [bystander.pid, 0]
    ])

    expect(bystander.exitCode).toBeNull()
    expect(bystander.signalCode).toBeNull()
  })

  it('reads EPERM on its probe as alive and keeps waiting its three seconds', async () => {
    const kill = fakeKill('EPERM')
    // The driver answers over a real socket, only the quit wait is on the clock.
    vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'Date']})

    let outcome: unknown
    void openSafariWebDriverSession(tools, {attempts: 1}).then((value) => {
      outcome = value
    })

    while (!outcome) {
      await vi.advanceTimersByTimeAsync(100)
      await new Promise((resolve) => setImmediate(resolve))
    }

    // Probed every 100 ms until the three seconds are up.
    expect(outcome).toEqual({reason: REFUSAL})
    expect(kill.mock.calls).toEqual([
      [bystander.pid, 'SIGTERM'],
      ...Array.from({length: 30}, () => [bystander.pid, 0])
    ])
  })
})
