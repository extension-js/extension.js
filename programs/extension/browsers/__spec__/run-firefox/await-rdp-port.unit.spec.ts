import {type ChildProcess, spawn} from 'node:child_process'
import * as fs from 'node:fs'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {stampReadyRdpPort} from '../../browsers-lib/ready-stamp'
import {
  stampReadyWhenRdpPortOpens,
  waitForRdpPort
} from '../../run-firefox/firefox-launch/await-rdp-port'

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const {port} = server.address() as net.AddressInfo
      server.close(() => resolve(port))
    })
  })

// A stand-in for Firefox: a process that is up at once and opens its debugger
// server only after a delay, the window the contract used to go ready in.
const spawnLateFirefox = (port: number, delayMs: number) =>
  spawn(
    process.execPath,
    [
      '-e',
      `setTimeout(() => require('node:net').createServer((s) => s.end()).listen(${port}, '127.0.0.1'), ${delayMs})`
    ],
    {stdio: 'ignore'}
  )

describe('a Firefox dev session stamps ready only once the RDP port is known', () => {
  let tmp: string
  let outputPath: string
  let readyPath: string
  let firefox: ChildProcess | undefined

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'await-rdp-port-'))
    outputPath = path.join(tmp, 'dist', 'firefox')
    readyPath = path.join(tmp, 'dist', 'extension-js', 'firefox', 'ready.json')
    fs.mkdirSync(path.dirname(readyPath), {recursive: true})
    fs.writeFileSync(
      readyPath,
      JSON.stringify({
        status: 'starting',
        command: 'dev',
        browser: 'firefox',
        runId: 'run-A',
        compiledAt: '2026-11-01T00:00:00.000Z',
        errors: []
      })
    )
  })

  afterEach(() => {
    firefox?.kill('SIGKILL')
    firefox = undefined
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  const read = () => JSON.parse(fs.readFileSync(readyPath, 'utf-8'))

  it('carries rdpPort on the first contract a reader sees as ready, when Firefox opens the port late', async () => {
    const port = await freePort()
    const seen: Array<Record<string, unknown>> = []
    const watcher = setInterval(() => {
      try {
        seen.push(read())
      } catch {
        // a reader can land between the atomic rename's steps
      }
    }, 5)

    firefox = spawnLateFirefox(port, 400)
    const startedAt = Date.now()

    try {
      const result = await stampReadyWhenRdpPortOpens(outputPath, {
        port,
        deadlineMs: 10_000,
        intervalMs: 20,
        runId: 'run-A'
      })

      expect(result).toEqual({open: true})
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(300)
    } finally {
      clearInterval(watcher)
    }

    seen.push(read())

    const firstReady = seen.find((doc) => doc.status === 'ready')
    expect(firstReady).toBeDefined()
    expect(firstReady?.rdpPort).toBe(port)
    expect(seen.some((doc) => doc.status === 'starting')).toBe(true)
    expect(
      seen.every((doc) => doc.status !== 'ready' || doc.rdpPort === port)
    ).toBe(true)

    expect(read().rdpPortError).toBeUndefined()
  })

  it('writes ready with an rdpPortError naming the port and the deadline when Firefox never opens it', async () => {
    const port = await freePort()

    const result = await stampReadyWhenRdpPortOpens(outputPath, {
      port,
      deadlineMs: 300,
      intervalMs: 20,
      runId: 'run-A'
    })

    expect(result.open).toBe(false)

    const ready = read()
    expect(ready.status).toBe('ready')
    expect(ready.rdpPort).toBeUndefined()
    expect(ready.rdpPortError).toBe(
      `Firefox did not open its remote debugging port ${port} within 300ms`
    )
  })

  it('names the exit when Firefox leaves before opening the port', async () => {
    const port = await freePort()

    const result = await waitForRdpPort({
      port,
      deadlineMs: 10_000,
      isBrowserGone: () => true
    })

    expect(result).toEqual({
      open: false,
      reason: `Firefox exited before it opened its remote debugging port ${port}`
    })
  })

  it('a port that opens after the error replaces it', () => {
    fs.writeFileSync(
      readyPath,
      JSON.stringify({...read(), status: 'ready', rdpPortError: 'late'})
    )

    stampReadyRdpPort(outputPath, 6006)

    expect(read().rdpPort).toBe(6006)
    expect(read().rdpPortError).toBeUndefined()
  })

  it('leaves a start receipt at starting, since start stamps ready after the install', async () => {
    fs.writeFileSync(readyPath, JSON.stringify({...read(), command: 'start'}))

    stampReadyRdpPort(outputPath, 6006)

    expect(read().status).toBe('starting')
    expect(read().rdpPort).toBe(6006)
  })

  it('never turns an error contract ready', () => {
    fs.writeFileSync(
      readyPath,
      JSON.stringify({...read(), status: 'error', code: 'browser_exited'})
    )

    stampReadyRdpPort(outputPath, 6006)

    expect(read().status).toBe('error')
  })
})
