import {spawn} from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import type {AddressInfo} from 'node:net'
import os from 'node:os'
import path from 'node:path'
import {describe, expect, it} from 'vitest'

function cliRoot(): string {
  return path.resolve(__dirname, '..')
}

function cliBin(): string {
  const cjs = path.join(cliRoot(), 'dist', 'cli.cjs')
  if (fs.existsSync(cjs)) return cjs

  return path.join(cliRoot(), 'dist', 'cli.js')
}

// A rejection that exists before the CLI loads reaches Node from outside the
// awaited command promise, which is the path a telemetry listener swallowed.
const CRASH_PRELOAD = 'Promise.reject(new Error("injected async crash"))\n'

interface CrashRun {
  status: number | null
  stderr: string
  elapsedMs: number
}

function runWithInjectedCrash(
  telemetry: '0' | '1',
  sink = 'http://127.0.0.1:1'
): Promise<CrashRun> {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-crash-'))
  const configHome = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-config-'))
  const cacheHome = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-cache-'))
  const preload = path.join(work, 'crash.cjs')
  fs.writeFileSync(preload, CRASH_PRELOAD, 'utf8')

  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        '--require',
        preload,
        cliBin(),
        'create',
        './crashing-extension',
        '--template',
        'javascript'
      ],
      {
        cwd: work,
        stdio: ['ignore', 'ignore', 'pipe'],
        env: {
          ...process.env,
          EXTENSION_TELEMETRY: telemetry,
          // Nothing may leave the machine for a spec: the sink is a refused
          // loopback port or the local fake server below.
          POSTHOG_HOST: sink,
          XDG_CONFIG_HOME: configHome,
          XDG_CACHE_HOME: cacheHome
        }
      }
    )

    const started = Date.now()
    let stderr = ''
    child.stderr?.on('data', (chunk) => (stderr += String(chunk)))
    child.on('close', (status) =>
      resolve({
        status,
        stderr: normalize(stderr, work),
        elapsedMs: Date.now() - started
      })
    )
  })
}

// A local stand-in for the collector: records every batch it is handed and
// either acknowledges it or, when asked, never answers at all.
interface FakeSink {
  url: string
  received: Array<{event: string; command: string}>
  close: () => Promise<void>
}

function startFakeSink(mode: 'ack' | 'hang'): Promise<FakeSink> {
  const received: FakeSink['received'] = []
  const sockets = new Set<import('node:net').Socket>()
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => (body += String(chunk)))
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body) as {
          batch?: Array<{event: string; properties?: {command?: string}}>
        }

        for (const entry of parsed.batch || []) {
          received.push({
            event: entry.event,
            command: String(entry.properties?.command)
          })
        }
      } catch {
        received.push({event: 'unparsable', command: ''})
      }

      if (mode === 'hang') return

      res.writeHead(200, {'content-type': 'application/json'})
      res.end('{"status":1}')
    })
  })
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const {port} = server.address() as AddressInfo
      resolve({
        url: `http://127.0.0.1:${port}`,
        received,
        close: () =>
          new Promise((done) => {
            for (const socket of sockets) socket.destroy()
            server.close(() => done())
          })
      })
    })
  })
}

// Every run gets its own temp dir and its own pid, so paths and the pid Node
// stamps on its own warnings are the two things that legitimately differ.
function normalize(stderr: string, work: string): string {
  let out = stderr

  for (const dir of new Set([work, realpath(work)])) {
    out = out.split(dir).join('<work>')
  }

  return out.replace(/\(node:\d+\)/g, '(node:<pid>)').trim()
}

function realpath(dir: string): string {
  try {
    return fs.realpathSync(dir)
  } catch {
    return dir
  }
}

describe('telemetry never changes what a crashing command does', () => {
  it('dies the same way with telemetry on as with telemetry off', async () => {
    const [on, off] = await Promise.all([
      runWithInjectedCrash('1'),
      runWithInjectedCrash('0')
    ])

    // The opted-out run is the reference: Node prints the stack and exits 1.
    expect(off.status).toBe(1)
    expect(off.stderr).toContain('injected async crash')

    expect(on.status).toBe(off.status)
    expect(on.stderr).toBe(off.stderr)
  }, 120000)
})

describe('a crash still reports itself, without touching the exit', () => {
  it('delivers command_failed to the sink before the default death', async () => {
    const sink = await startFakeSink('ack')

    try {
      const [on, off] = await Promise.all([
        runWithInjectedCrash('1', sink.url),
        runWithInjectedCrash('0', sink.url)
      ])

      expect(off.status).toBe(1)
      expect(on.status).toBe(1)
      expect(on.stderr).toBe(off.stderr)
      expect(sink.received).toEqual([
        {event: 'command_failed', command: 'create'}
      ])
    } finally {
      await sink.close()
    }
  }, 120000)

  it('sends nothing when telemetry is off', async () => {
    const sink = await startFakeSink('ack')

    try {
      const run = await runWithInjectedCrash('0', sink.url)
      expect(run.status).toBe(1)
      expect(sink.received).toEqual([])
    } finally {
      await sink.close()
    }
  }, 120000)

  it('gives up on a sink that never answers inside a short bound', async () => {
    const sink = await startFakeSink('hang')

    try {
      const [on, off] = await Promise.all([
        runWithInjectedCrash('1', sink.url),
        runWithInjectedCrash('0', sink.url)
      ])

      expect(on.status).toBe(1)
      expect(on.stderr).toBe(off.stderr)
      // The bound is one second plus the sender's startup. Generous here
      // because the suite shares the machine, tight enough to catch a wait
      // on the transport's own deadline.
      expect(on.elapsedMs - off.elapsedMs).toBeLessThan(4000)
    } finally {
      await sink.close()
    }
  }, 120000)
})
