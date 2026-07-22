import {spawn} from 'node:child_process'
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {createServer, type Server} from 'node:http'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {WebSocketServer} from 'ws'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const cliRoot = resolve(__dirname, '../..')
const cliBin = resolve(cliRoot, 'dist', 'cli.cjs')

// Big enough that the frame cannot fit in one pipe buffer (64KB on macOS
// sockets): a pre-drain exit truncates it, the drained exit must not (#79).
const VALUE_BYTES = 256 * 1024

let server: Server
let wss: WebSocketServer
let controlPort: number
let projectDir: string

beforeAll(async () => {
  server = createServer()
  wss = new WebSocketServer({server, path: '/extjs-control'})

  wss.on('connection', (socket) => {
    socket.on('message', (data) => {
      let frame: {type?: string; cmdId?: string}
      try {
        frame = JSON.parse(data.toString())
      } catch {
        return
      }

      if (frame.type === 'hello') {
        socket.send(JSON.stringify({type: 'ready', v: 1, capabilities: {}}))
        return
      }

      if (frame.type === 'command') {
        socket.send(
          JSON.stringify({
            type: 'result',
            cmdId: frame.cmdId,
            ok: true,
            value: 'x'.repeat(VALUE_BYTES)
          })
        )
      }
    })
  })

  await new Promise<void>((resolvePromise) =>
    server.listen(0, '127.0.0.1', resolvePromise)
  )
  const address = server.address()
  controlPort = typeof address === 'object' && address ? address.port : 0

  projectDir = mkdtempSync(join(tmpdir(), 'extjs-act-drain-'))
  const readyDir = join(projectDir, 'dist', 'extension-js', 'chromium')
  mkdirSync(readyDir, {recursive: true})
  writeFileSync(
    join(readyDir, 'ready.json'),
    JSON.stringify({
      status: 'ready',
      controlPort,
      instanceId: 'inst-drain',
      runId: 'run-drain'
    })
  )
})

afterAll(async () => {
  wss.close()
  await new Promise<void>((resolvePromise) =>
    server.close(() => resolvePromise())
  )
  rmSync(projectDir, {recursive: true, force: true})
})

describe('act --output json stdout drain contract (#79)', () => {
  it('delivers a frame larger than one pipe buffer intact before exiting', async () => {
    const result = await new Promise<{code: number; stdout: string}>(
      (resolvePromise, reject) => {
        const child = spawn(
          process.execPath,
          [cliBin, 'reload', projectDir, '--output', 'json'],
          {cwd: cliRoot, stdio: 'pipe'}
        )
        let stdout = ''
        child.stdout.on('data', (chunk) => (stdout += chunk.toString()))
        child.stderr.on('data', () => {})
        const timer = setTimeout(() => {
          child.kill('SIGKILL')
          reject(new Error('CLI timed out'))
        }, 30000)
        child.on('close', (code) => {
          clearTimeout(timer)
          resolvePromise({code: code ?? 1, stdout})
        })
        child.on('error', (error) => {
          clearTimeout(timer)
          reject(error)
        })
      }
    )

    expect(result.code).toBe(0)
    expect(result.stdout.length).toBeGreaterThan(VALUE_BYTES)

    const frame = JSON.parse(result.stdout)
    expect(frame.ok).toBe(true)
    expect(frame.value).toHaveLength(VALUE_BYTES)
  }, 40000)
})
