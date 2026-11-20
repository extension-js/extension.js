import {spawnSync} from 'node:child_process'
import * as fs from 'node:fs'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeAll, beforeEach, describe, expect, it} from 'vitest'

import {
  endedSessionReason,
  isSessionRunning,
  reusedPidEvidence,
  runningSessionBrowsers,
  sessionEndedMessage
} from '../session-liveness'

const READY_PATH = '/proj/dist/extension-js/chrome/ready.json'

// The process table's answer for a pid's start time, which a real read would
// get by shelling out.
function startedAt(iso: string | null) {
  return () => (iso === null ? null : Date.parse(iso))
}

let server: net.Server
let livePort = 0
let silentPort = 0
let deadPid = 0

function listen(): Promise<net.Server> {
  return new Promise((resolve) => {
    const created = net.createServer((socket) => socket.destroy())

    created.listen(0, '127.0.0.1', () => resolve(created))
  })
}

beforeEach(async () => {
  server = await listen()
  livePort = (server.address() as net.AddressInfo).port

  const closed = await listen()
  silentPort = (closed.address() as net.AddressInfo).port
  await new Promise((resolve) => closed.close(resolve))
})

// One exited child serves every test: its pid stays dead for the file.
beforeAll(() => {
  deadPid = spawnSync(process.execPath, ['-e', '']).pid
})

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve))
})

describe('endedSessionReason', () => {
  it('ends a contract that reads stopped, even with its port still answering', async () => {
    expect(
      await endedSessionReason(
        {status: 'stopped', pid: process.pid, controlPort: livePort},
        READY_PATH
      )
    ).toBe(`${READY_PATH} reads status 'stopped'`)
  })

  it('ends a contract that reads ready when its pid is gone and its port is silent', async () => {
    const reason = await endedSessionReason(
      {status: 'ready', pid: deadPid, controlPort: silentPort},
      READY_PATH
    )

    expect(reason).toContain(`its process (pid ${deadPid}) is gone`)
    expect(reason).toContain(`controlPort ${silentPort}`)
  })

  it('keeps a session whose pid this machine cannot see while its port answers', async () => {
    expect(
      await endedSessionReason(
        {status: 'ready', pid: deadPid, controlPort: livePort},
        READY_PATH
      )
    ).toBeNull()
  })

  it('keeps a live pid and a contract with no pid for the dial to judge', async () => {
    expect(
      await endedSessionReason(
        {status: 'ready', pid: process.pid, controlPort: silentPort},
        READY_PATH
      )
    ).toBeNull()

    expect(
      await endedSessionReason(
        {status: 'ready', controlPort: silentPort},
        READY_PATH
      )
    ).toBeNull()
  })

  it('ends a session whose pid another process holds once the dial has failed', async () => {
    const stamped = '2026-11-15T01:00:00.000Z'
    const reusedAt = startedAt('2026-11-15T03:00:00.000Z')

    const contract = {
      status: 'ready',
      pid: process.pid,
      pidStartedAt: stamped,
      controlPort: silentPort
    }

    expect(
      await endedSessionReason(contract, READY_PATH, undefined, reusedAt)
    ).toBeNull()

    const reason = await endedSessionReason(
      contract,
      READY_PATH,
      {dialFailed: true},
      reusedAt
    )

    expect(reason).toContain(`pid ${process.pid}`)
    expect(reason).toContain('now belongs to another process')
    expect(reason).toContain(stamped)
  })

  it('keeps a live pid that started when the contract says it did', async () => {
    expect(
      await endedSessionReason(
        {
          status: 'ready',
          pid: process.pid,
          pidStartedAt: '2026-11-15T01:00:00.000Z',
          controlPort: silentPort
        },
        READY_PATH,
        {dialFailed: true},
        startedAt('2026-11-15T01:00:00.600Z')
      )
    ).toBeNull()
  })
})

describe('reusedPidEvidence', () => {
  it('reads the stamped pid start before the run start', () => {
    const thirtySecondsIn = startedAt('2026-11-15T01:00:30.000Z')

    // 30 s after the stamp: inside the run-start skew, outside the pid one.
    expect(
      reusedPidEvidence(
        {pid: 1, startedAt: '2026-11-15T01:00:00.000Z'},
        thirtySecondsIn
      )
    ).toBeNull()

    expect(
      reusedPidEvidence(
        {
          pid: 1,
          startedAt: '2026-11-15T01:00:00.000Z',
          pidStartedAt: '2026-11-15T01:00:00.000Z'
        },
        thirtySecondsIn
      )
    ).toContain("not at the contract's 2026-11-15T01:00:00.000Z")
  })

  it('answers nothing when the process table cannot date the pid', () => {
    expect(
      reusedPidEvidence(
        {pid: 1, pidStartedAt: '2026-11-15T01:00:00.000Z'},
        startedAt(null)
      )
    ).toBeNull()
  })
})

describe('reusedPidEvidence with a process start id', () => {
  const STAMPED = '2026-11-15T01:00:00.000Z'

  const never = () => {
    throw new Error('the dates were asked while the ids could decide')
  }

  it('trusts an equal id over a clock that stepped an hour', () => {
    expect(
      reusedPidEvidence(
        {pid: 7, pidStartedAt: STAMPED, pidStartId: 'boot-a:5000'},
        never,
        () => 'boot-a:5000'
      )
    ).toBeNull()

    // What the date rule alone says of the same stepped clock.
    expect(
      reusedPidEvidence(
        {pid: 7, pidStartedAt: STAMPED},
        startedAt('2026-11-15T02:00:00.000Z'),
        () => 'boot-a:5000'
      )
    ).toContain("not at the contract's")
  })

  it.each([
    ['another tick', 'boot-a:9000'],
    ['another boot', 'boot-b:5000']
  ])('names a reused pid by %s although the dates agree', (_title, current) => {
    expect(
      reusedPidEvidence(
        {pid: 7, pidStartedAt: STAMPED, pidStartId: 'boot-a:5000'},
        never,
        () => current
      )
    ).toBe(`its start id is ${current}, not the contract's boot-a:5000`)
  })

  it('falls back on the dates when this machine reads no id', () => {
    expect(
      reusedPidEvidence(
        {pid: 7, pidStartedAt: STAMPED, pidStartId: 'boot-a:5000'},
        startedAt('2026-11-15T01:00:30.000Z'),
        () => undefined
      )
    ).toContain("not at the contract's")

    expect(
      reusedPidEvidence(
        {pid: 7, pidStartedAt: STAMPED, pidStartId: 'boot-a:5000'},
        startedAt(STAMPED),
        () => undefined
      )
    ).toBeNull()
  })

  it('reads no id for a contract that carries none', () => {
    const neverId = () => {
      throw new Error('an id was read for a contract without one')
    }

    expect(
      reusedPidEvidence(
        {pid: 7, pidStartedAt: STAMPED},
        startedAt(STAMPED),
        neverId
      )
    ).toBeNull()

    expect(
      reusedPidEvidence(
        {pid: 7, pidStartedAt: STAMPED, pidStartId: ''},
        startedAt(STAMPED),
        neverId
      )
    ).toBeNull()
  })

  it('ends a session whose pid now runs under another id and whose port is silent', async () => {
    const reason = await endedSessionReason(
      {
        status: 'ready',
        pid: process.pid,
        pidStartedAt: STAMPED,
        pidStartId: 'boot-a:5000',
        controlPort: silentPort
      },
      READY_PATH,
      {dialFailed: true},
      never,
      () => 'boot-a:9000'
    )

    expect(reason).toContain('now belongs to another process')
    expect(reason).toContain(
      "its start id is boot-a:9000, not the contract's boot-a:5000"
    )
  })
})

describe('isSessionRunning and runningSessionBrowsers', () => {
  it('calls a session running only when it was not stopped and its port answers', async () => {
    expect(await isSessionRunning(null)).toBe(false)
    expect(
      await isSessionRunning({status: 'stopped', controlPort: livePort})
    ).toBe(false)

    expect(
      await isSessionRunning({status: 'ready', controlPort: silentPort})
    ).toBe(false)

    expect(
      await isSessionRunning({status: 'ready', controlPort: livePort})
    ).toBe(true)
  })

  it('offers the one live browser among a stopped one and a killed one', async () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'live-sessions-'))
    const contracts: Record<string, object> = {
      chrome: {status: 'stopped', pid: deadPid, controlPort: silentPort},
      edge: {status: 'ready', pid: deadPid, controlPort: silentPort},
      firefox: {status: 'ready', pid: process.pid, controlPort: livePort}
    }

    for (const browser of Object.keys(contracts)) {
      fs.mkdirSync(path.join(project, 'dist', 'extension-js', browser), {
        recursive: true
      })
    }

    try {
      expect(
        await runningSessionBrowsers(
          {},
          project,
          'chromium',
          (_project, browser) => contracts[browser] ?? null
        )
      ).toEqual(['firefox'])
    } finally {
      fs.rmSync(project, {recursive: true, force: true})
    }
  })
})

describe('sessionEndedMessage', () => {
  it.each([
    ['dev', 'The dev session for chrome ended'],
    ['start', 'The extension start session for chrome ended'],
    ['preview', 'The extension preview session for chrome ended']
  ])('names the %s command that starts the session again', (command, opening) => {
    const message = sessionEndedMessage({
      ready: {command},
      browser: 'chrome',
      reason: `${READY_PATH} reads status 'stopped'`,
      flag: '--allow-eval'
    })

    expect(message).toContain(opening)
    expect(message).toContain(
      `Run \`extension ${command} --browser=chrome --allow-eval\` to start one.`
    )

    expect(message).not.toContain('is running')
  })
})
