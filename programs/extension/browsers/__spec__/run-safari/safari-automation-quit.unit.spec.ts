import {type ChildProcess, spawn} from 'node:child_process'
import {once} from 'node:events'
import * as http from 'node:http'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {
  openSafariWebDriverSession,
  type SafariQuitDependencies
} from '../../run-safari/safari-launch/webdriver'
import {type FakeSafariTools, fakeSafariTools} from '../safari-fake-tools'

const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP', 'exit'] as const
const REFUSAL = 'Could not create a session: refused by the test'

// No process can carry this pid, so nothing dates or signals a real one.
const DRIVER_PID = 2 ** 30
const DRIVER_STARTED = Date.parse('2026-11-17T10:00:05.000Z')

// A safaridriver that is up and refuses the session, or grants it, served in
// this process.
function refusingDriver(port: number, grants = false): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      req.resume()
      req.on('end', () => {
        const ready = req.method === 'GET' && req.url === '/status'
        const ok = ready || grants
        res.writeHead(ok ? 200 : 500, {'Content-Type': 'application/json'})
        res.end(
          JSON.stringify({
            value: ready
              ? {ready: true}
              : grants
                ? {sessionId: 'session-1'}
                : {error: 'session not created', message: REFUSAL}
          })
        )
      })
    })
    server.listen(port, '127.0.0.1', () => resolve(server))
  })
}

// The process list, the start times, the probe and the signal are scripted: a
// real automation Safari may run on this machine and is never read or reached.
describe('the automation Safari a session quits on its way out', () => {
  let bystander: ChildProcess
  let servers: http.Server[]
  let listenersBefore: Map<string, unknown[]>
  let tools: FakeSafariTools
  let events: string[]
  let printed: string[]
  let safari: number

  beforeEach(async () => {
    servers = []
    events = []
    printed = []
    listenersBefore = new Map(
      SIGNALS.map((name) => [name, process.listeners(name as 'exit')])
    )

    // Its pid stands in for the automation Safari, so nothing else can be hit.
    bystander = spawn(
      process.execPath,
      ['-e', 'setInterval(() => {}, 1000)', 'extjs-spec-bystander'],
      {stdio: 'ignore'}
    )

    await once(bystander, 'spawn')
    safari = bystander.pid as number

    let listings = 0
    tools = fakeSafariTools()
    // Absent when the session takes its snapshot, there when it stops.
    tools.listAutomationPids = async () => (listings++ === 0 ? [] : [safari])
    useDriver(DRIVER_PID)
  })

  afterEach(async () => {
    vi.useRealTimers()

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
    process.kill(safari, 'SIGKILL')
    await exited
  })

  function useDriver(pid: number | undefined, grants = false) {
    tools.startWebDriver = async (port) => {
      const server = await refusingDriver(port, grants)
      servers.push(server)

      return {
        ok: true,
        pid,
        output: '',
        stop: () => {
          events.push('driver stopped')
          server.closeAllConnections()
        }
      }
    }
  }

  // Each pid answers its reads in order, and its last answer from then on.
  function scripted(
    starts: {driver: Array<number | null>; safari: Array<number | null>},
    alive = false
  ): SafariQuitDependencies {
    const answers = new Map([
      [DRIVER_PID, [...starts.driver]],
      [safari, [...starts.safari]]
    ])

    return {
      platform: 'darwin',
      isAlive: (pid) => {
        events.push(`probed ${pid === safari ? 'safari' : pid}`)

        return alive
      },
      startedAt: (pid) => {
        const left = answers.get(pid) as Array<number | null>
        events.push(`dated ${pid === safari ? 'safari' : 'driver'}`)

        return left.length > 1 ? (left.shift() as number | null) : left[0]
      },
      kill: (pid, signal) => {
        events.push(`sent ${signal} to ${pid === safari ? 'safari' : pid}`)

        return true
      },
      print: (line) => printed.push(line)
    }
  }

  function leftRunningLine() {
    return (
      `⏵⏵⏵ Safari (pid ${safari}) did not stop and could not be confirmed as the browser this run started, so it was left running. ` +
      `To stop it, run kill -9 ${safari}.`
    )
  }

  async function refusedSession(teardown: SafariQuitDependencies) {
    const outcome = await openSafariWebDriverSession(tools, {
      attempts: 1,
      teardown
    })

    expect(outcome).toEqual({reason: REFUSAL})
    expect(servers).toHaveLength(1)
    expect(bystander.exitCode).toBeNull()
    expect(bystander.signalCode).toBeNull()
  }

  it('quits the Safari that appeared since its snapshot and started after its own driver', async () => {
    await refusedSession(
      scripted({driver: [DRIVER_STARTED], safari: [DRIVER_STARTED + 2000]})
    )

    // The driver is dated again while it still runs, then stopped.
    expect(events).toEqual([
      'dated driver',
      'dated driver',
      'driver stopped',
      'dated safari',
      'sent SIGTERM to safari',
      'probed safari'
    ])

    expect(printed).toEqual([])
  })

  it('counts a Safari dated in the same second as its driver as started after it', async () => {
    await refusedSession(
      scripted({driver: [DRIVER_STARTED], safari: [DRIVER_STARTED]})
    )

    expect(events).toContain('sent SIGTERM to safari')
    expect(printed).toEqual([])
  })

  it('leaves a Safari that started before its driver and says so once', async () => {
    await refusedSession(
      scripted({driver: [DRIVER_STARTED], safari: [DRIVER_STARTED - 1000]})
    )

    expect(events).toEqual([
      'dated driver',
      'dated driver',
      'driver stopped',
      'dated safari'
    ])

    expect(printed).toEqual([leftRunningLine()])
  })

  it('leaves the Safari when the driver pid no longer carries its spawn time', async () => {
    await refusedSession(
      scripted({
        driver: [DRIVER_STARTED, DRIVER_STARTED + 1000],
        safari: [DRIVER_STARTED + 2000]
      })
    )

    // Nothing is sent and the Safari is not even dated.
    expect(events).toEqual(['dated driver', 'dated driver', 'driver stopped'])
    expect(printed).toEqual([leftRunningLine()])
  })

  it.each([
    {
      unreadable: 'the driver at spawn',
      driver: [null],
      safari: [DRIVER_STARTED + 2000],
      dated: ['dated driver', 'driver stopped']
    },
    {
      unreadable: 'the driver as it is stopped',
      driver: [DRIVER_STARTED, null],
      safari: [DRIVER_STARTED + 2000],
      dated: ['dated driver', 'dated driver', 'driver stopped']
    },
    {
      unreadable: 'the Safari',
      driver: [DRIVER_STARTED],
      safari: [null],
      dated: ['dated driver', 'dated driver', 'driver stopped', 'dated safari']
    }
  ])('leaves the Safari when no start time can be read for $unreadable', async ({
    driver,
    safari: safariStarts,
    dated
  }) => {
    await refusedSession(scripted({driver, safari: safariStarts}))

    expect(events).toEqual(dated)
    expect(printed).toEqual([leftRunningLine()])
  })

  it('leaves the Safari when the driver reported no pid to prove', async () => {
    useDriver(undefined)

    await refusedSession(
      scripted({driver: [DRIVER_STARTED], safari: [DRIVER_STARTED + 2000]})
    )

    expect(events).toEqual(['driver stopped'])
    expect(printed).toEqual([leftRunningLine()])
  })

  it('keeps probing a Safari that stays up for its three seconds', async () => {
    const teardown = scripted(
      {driver: [DRIVER_STARTED], safari: [DRIVER_STARTED + 2000]},
      true
    )
    // The driver answers over a real socket, only the quit wait is on the clock.
    vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'Date']})

    let outcome: unknown
    void openSafariWebDriverSession(tools, {attempts: 1, teardown}).then(
      (value) => {
        outcome = value
      }
    )

    while (!outcome) {
      await vi.advanceTimersByTimeAsync(100)
      await new Promise((resolve) => setImmediate(resolve))
    }

    // One signal, then a probe every 100 ms until the three seconds are up.
    expect(outcome).toEqual({reason: REFUSAL})
    expect(events.slice(4)).toEqual([
      'sent SIGTERM to safari',
      ...Array.from({length: 30}, () => 'probed safari')
    ])

    expect(printed).toEqual([])
  })

  describe('when the process exits with the session still open', () => {
    // A fresh module, so its exit handler is installed for this test alone.
    async function openSession(teardown: SafariQuitDependencies) {
      vi.resetModules()
      const fresh = await import('../../run-safari/safari-launch/webdriver')
      useDriver(DRIVER_PID, true)

      const outcome = await fresh.openSafariWebDriverSession(tools, {
        attempts: 1,
        teardown
      })

      expect(outcome.session?.sessionId).toBe('session-1')
      events.length = 0

      const added = process
        .listeners('exit')
        .filter((listener) => !listenersBefore.get('exit')?.includes(listener))

      expect(added).toHaveLength(1)
      ;(added[0] as (code: number) => void)(0)
    }

    it('quits the Safari the session raised, after its driver', async () => {
      await openSession(
        scripted({driver: [DRIVER_STARTED], safari: [DRIVER_STARTED + 2000]})
      )

      expect(events).toEqual([
        'dated driver',
        'driver stopped',
        'dated safari',
        'sent SIGTERM to safari'
      ])

      expect(printed).toEqual([])
    })

    it('leaves a Safari that started before its driver and says so', async () => {
      await openSession(
        scripted({driver: [DRIVER_STARTED], safari: [DRIVER_STARTED - 1000]})
      )

      expect(events).toEqual(['dated driver', 'driver stopped', 'dated safari'])
      expect(printed).toEqual([leftRunningLine()])
    })
  })
})
