import * as fs from 'node:fs'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {claimDebugPortNear} from '../../browsers-lib/debug-port-claim'

function listenOn(port: number): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve(server))
  })
}

// How many ports in a row the cases below count on being free.
const RUN_LENGTH = 4

async function isFree(port: number): Promise<boolean> {
  try {
    const server = await listenOn(port)
    await new Promise((resolve) => server.close(resolve))

    return true
  } catch {
    return false
  }
}

// A run of ports nothing listens on. The system names the first, and each
// neighbor is tried too, since another process may hold any of them.
async function freeStartPort(): Promise<number> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const server = await listenOn(0)
    const {port} = server.address() as net.AddressInfo
    await new Promise((resolve) => server.close(resolve))

    const start = port > 60000 ? port - 2000 : port
    const run = Array.from({length: RUN_LENGTH}, (_, index) => start + index)

    if ((await Promise.all(run.map(isFree))).every(Boolean)) return start
  }

  throw new Error('no run of free ports to test a debug port claim on')
}

// A pid that named a process once and names none now.
function deadPid(): number {
  for (let pid = 999_999; pid > 900_000; pid--) {
    try {
      process.kill(pid, 0)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return pid
    }
  }

  throw new Error('no free pid to stand in for a dead session')
}

describe('claimDebugPortNear', () => {
  let dir: string
  let start: number

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'debug-port-claim-'))
    start = await freeStartPort()
  })

  afterEach(() => {
    fs.rmSync(dir, {recursive: true, force: true})
  })

  it('hands four sessions asking at the same moment four different ports', async () => {
    const claims = await Promise.all(
      [0, 1, 2, 3].map(() => claimDebugPortNear(start, {dir}))
    )
    const ports = claims.map((claim) => claim.port).sort((a, b) => a - b)

    expect(new Set(ports).size).toBe(4)
    expect(ports[0]).toBeGreaterThanOrEqual(start)

    for (const claim of claims) claim.release()
  })

  it('keeps a port another live session claimed, though nothing listens on it yet', async () => {
    // The parent process stands in for a session that probed first and has
    // not launched its browser.
    fs.writeFileSync(
      path.join(dir, `${start}.claim`),
      JSON.stringify({pid: process.ppid, claimedAt: Date.now()})
    )

    const claim = await claimDebugPortNear(start, {dir})

    expect(claim.port).toBe(start + 1)
    expect(fs.existsSync(path.join(dir, `${start}.claim`))).toBe(true)

    claim.release()
  })

  it('takes over the claim of a session that died', async () => {
    fs.writeFileSync(
      path.join(dir, `${start}.claim`),
      JSON.stringify({pid: deadPid(), claimedAt: Date.now() - 5000})
    )

    const claim = await claimDebugPortNear(start, {dir})

    expect(claim.port).toBe(start)
    expect(
      JSON.parse(fs.readFileSync(path.join(dir, `${start}.claim`), 'utf8')).pid
    ).toBe(process.pid)

    claim.release()
    expect(fs.readdirSync(dir)).toEqual([])
  })

  it('treats a claim written a moment ago with nothing in it as held', async () => {
    fs.writeFileSync(path.join(dir, `${start}.claim`), '')

    const claim = await claimDebugPortNear(start, {dir})

    expect(claim.port).toBe(start + 1)

    claim.release()
  })

  it('skips a port something already listens on and leaves no claim on it', async () => {
    const server = await listenOn(start)

    try {
      const claim = await claimDebugPortNear(start, {dir})

      expect(claim.port).toBe(start + 1)
      expect(fs.readdirSync(dir)).toEqual([`${start + 1}.claim`])

      claim.release()
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  })

  it('gives a released port to the next session', async () => {
    const first = await claimDebugPortNear(start, {dir})
    first.release()

    const second = await claimDebugPortNear(start, {dir})

    expect(second.port).toBe(first.port)

    second.release()
  })

  // Pins today's behavior. Ledger 1374 D6.
  it('hands back the start port with nothing to release once every attempt found a listener', async () => {
    const servers = [await listenOn(start), await listenOn(start + 1)]

    try {
      const claim = await claimDebugPortNear(start, {dir, maxAttempts: 2})

      expect(claim.port).toBe(start)
      expect(fs.readdirSync(dir)).toEqual([])

      // The port it answered with is still taken, and no claim covers it.
      await expect(listenOn(claim.port)).rejects.toMatchObject({
        code: 'EADDRINUSE'
      })

      claim.release()
      expect(fs.readdirSync(dir)).toEqual([])
    } finally {
      for (const server of servers) {
        await new Promise((resolve) => server.close(resolve))
      }
    }
  })

  describe('a claim whose owner this user may not signal', () => {
    afterEach(() => vi.restoreAllMocks())

    it('reads EPERM as a live owner and leaves its claim alone', async () => {
      const owner = deadPid()
      const body = JSON.stringify({pid: owner, claimedAt: Date.now() - 5000})
      fs.writeFileSync(path.join(dir, `${start}.claim`), body)

      // The fake sends nothing: it only answers the signal 0 probe.
      const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
        throw Object.assign(new Error('kill EPERM'), {code: 'EPERM'})
      })

      const claim = await claimDebugPortNear(start, {dir})

      expect(kill.mock.calls).toEqual([[owner, 0]])
      expect(claim.port).toBe(start + 1)
      expect(fs.readFileSync(path.join(dir, `${start}.claim`), 'utf8')).toBe(
        body
      )

      claim.release()
    })
  })
})
