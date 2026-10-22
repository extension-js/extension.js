import {spawn} from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'

function cliBin(): string {
  const root = path.resolve(__dirname, '../..')
  const cjs = path.join(root, 'dist', 'cli.cjs')
  if (fs.existsSync(cjs)) return cjs

  return path.join(root, 'dist', 'cli.js')
}

interface CapturedEvent {
  event: string
  properties: Record<string, unknown>
}

function startCaptureServer(): Promise<{
  port: number
  events: CapturedEvent[]
  close: () => Promise<void>
}> {
  const events: CapturedEvent[] = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      if (req.url === '/capture/') {
        const parsed = JSON.parse(body) as {batch: CapturedEvent[]}
        events.push(...parsed.batch)
      }

      res.writeHead(200, {'content-type': 'application/json'})
      res.end('{"status":1}')
    })
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve({
        port,
        events,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done())
          })
      })
    })
  })
}

function run(args: string[], port: number): Promise<number | null> {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-tele-attr-'))
  const configHome = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-config-'))
  const cacheHome = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-cache-'))

  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cliBin(), ...args], {
      cwd: work,
      stdio: 'ignore',
      env: {
        ...process.env,
        POSTHOG_HOST: `http://127.0.0.1:${port}`,
        EXTENSION_TELEMETRY: '1',
        EXTENSION_TELEMETRY_TIMEOUT_MS: '5000',
        EXTENSION_NO_INSTALL_PROMPT: '1',
        XDG_CONFIG_HOME: configHome,
        XDG_CACHE_HOME: cacheHome
      }
    })
    child.on('close', (status) => resolve(status))
  })
}

function failures(events: CapturedEvent[]): CapturedEvent[] {
  return events.filter((event) => event.event === 'command_failed')
}

describe('a failed run names its command and the code the CLI chose', () => {
  let close: (() => Promise<void>) | undefined

  afterEach(async () => {
    if (close) await close()

    close = undefined
  })

  it('names the command behind a valued flag that comes first', async () => {
    const server = await startCaptureServer()
    close = server.close

    const status = await run(['--browser', 'chrome', 'dev'], server.port)

    expect(status).toBe(1)
    const [failed] = failures(server.events)
    expect(failed?.properties.command).toBe('dev')
  })

  it('reports an unrecognized verb as an unknown command without the verb', async () => {
    const server = await startCaptureServer()
    close = server.close

    await run(['my-secret-project'], server.port)

    const [failed] = failures(server.events)
    expect(failed?.properties.command).toBe('unknown')
    expect(failed?.properties.code).toBe('E_UNKNOWN_COMMAND')
    expect(JSON.stringify(server.events)).not.toContain('my-secret-project')
  })

  it('tells an unsupported flag apart from other argument errors', async () => {
    const server = await startCaptureServer()
    close = server.close

    await run(['dev', '--no-such-flag'], server.port)

    const [failed] = failures(server.events)
    expect(failed?.properties.command).toBe('dev')
    expect(failed?.properties.code).toBe('E_FLAG_NOT_SUPPORTED_HERE')
  })

  it('reports a refusal that exits before the build starts', async () => {
    const server = await startCaptureServer()
    close = server.close

    const status = await run(['build', '--browser=netscape'], server.port)

    expect(status).toBe(1)
    const [failed] = failures(server.events)
    expect(failed?.properties.command).toBe('build')
    expect(failed?.properties.code).toBe('E_UNSUPPORTED_BROWSER')
    expect(failed?.properties.exit_code).toBe(1)
  })

  it('reports a json build failure with its catalog code', async () => {
    const server = await startCaptureServer()
    close = server.close

    const status = await run(['build', '--output', 'json'], server.port)

    expect(status).toBe(1)
    const [failed] = failures(server.events)
    expect(failed?.properties.command).toBe('build')
    expect(typeof failed?.properties.code).toBe('string')
  })
})
