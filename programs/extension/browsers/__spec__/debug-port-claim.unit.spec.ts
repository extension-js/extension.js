import * as fs from 'node:fs'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {claimDebugPortNear} from '../browsers-lib/debug-port-claim'

function listenOn(port: number): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve(server))
  })
}

// A run of ports nothing listens on, found by asking the system for one.
async function freeStartPort(): Promise<number> {
  const server = await listenOn(0)
  const {port} = server.address() as net.AddressInfo
  await new Promise((resolve) => server.close(resolve))

  return port > 60000 ? port - 2000 : port
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
})
