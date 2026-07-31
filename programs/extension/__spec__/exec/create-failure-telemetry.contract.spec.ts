import {spawn} from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'

function cliRoot(): string {
  return path.resolve(__dirname, '../..')
}

function cliBin(): string {
  const cjs = path.join(cliRoot(), 'dist', 'cli.cjs')
  if (fs.existsSync(cjs)) return cjs
  return path.join(cliRoot(), 'dist', 'cli.js')
}

interface CaptureBatch {
  api_key: string
  batch: Array<{
    event: string
    properties: Record<string, unknown>
    distinct_id: string
  }>
}

function startCaptureServer(): Promise<{
  port: number
  batches: CaptureBatch[]
  close: () => Promise<void>
}> {
  const batches: CaptureBatch[] = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      if (req.url === '/capture/') {
        batches.push(JSON.parse(body) as CaptureBatch)
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
        batches,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done())
          })
      })
    })
  })
}

function runCreate(
  args: string[],
  port: number
): Promise<{status: number | null}> {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-create-fail-'))
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
        XDG_CONFIG_HOME: configHome,
        XDG_CACHE_HOME: cacheHome
      }
    })
    child.on('close', (status) => resolve({status}))
  })
}

describe('a failed create reports command_failed before it exits', () => {
  let close: (() => Promise<void>) | undefined

  afterEach(async () => {
    if (close) await close()
    close = undefined
  })

  it('flushes command_failed with template and source on the default output path', async () => {
    const server = await startCaptureServer()
    close = server.close

    const result = await runCreate(
      [
        'create',
        './telemetry-proof',
        '--template',
        'a-template-that-does-not-exist-xyz'
      ],
      server.port
    )

    expect(result.status).toBe(1)
    const events = server.batches.flatMap((batch) => batch.batch)
    const failed = events.filter((event) => event.event === 'command_failed')
    expect(failed).toHaveLength(1)
    expect(failed[0].properties.command).toBe('create')
    expect(failed[0].properties.success).toBe(false)
    expect(failed[0].properties.template).toBe(
      'a-template-that-does-not-exist-xyz'
    )
    expect(failed[0].properties.source).toBe('cli')
  }, 120000)

  it('flushes command_failed on the --output json path too', async () => {
    const server = await startCaptureServer()
    close = server.close

    const result = await runCreate(
      [
        'create',
        './telemetry-proof',
        '--template',
        'a-template-that-does-not-exist-xyz',
        '--output',
        'json'
      ],
      server.port
    )

    expect(result.status).toBe(1)
    const events = server.batches.flatMap((batch) => batch.batch)
    const failed = events.filter((event) => event.event === 'command_failed')
    expect(failed).toHaveLength(1)
    expect(failed[0].properties.command).toBe('create')
  }, 120000)
})
