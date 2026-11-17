import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {freshCliHome, runCli} from '../helpers/run-cli'

interface CaptureEvent {
  event: string
  properties: Record<string, unknown>
  distinct_id: string
}

function createFixture(): string {
  const projectDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'extjs-no-location-')
  )
  fs.mkdirSync(path.join(projectDir, 'content'), {recursive: true})
  fs.writeFileSync(
    path.join(projectDir, 'package.json'),
    JSON.stringify({name: 'no-location', private: true, version: '1.0.0'})
  )

  fs.writeFileSync(
    path.join(projectDir, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'No Location',
      version: '1.0.0',
      content_scripts: [{matches: ['<all_urls>'], js: ['content/scripts.js']}]
    })
  )

  fs.writeFileSync(
    path.join(projectDir, 'content', 'scripts.js'),
    "console.log('no location fixture')\n"
  )

  return projectDir
}

function startCaptureServer(): Promise<{
  port: number
  events: CaptureEvent[]
  close: () => Promise<void>
}> {
  const events: CaptureEvent[] = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      if (req.url === '/capture/') {
        const parsed = JSON.parse(body) as {batch?: CaptureEvent[]}
        for (const event of parsed.batch ?? []) events.push(event)
      }

      res.writeHead(200, {'content-type': 'application/json'})
      res.end('{"status":1}')
    })
  })

  return new Promise((done) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      done({
        port,
        events,
        close: () =>
          new Promise<void>((closed) => {
            server.close(() => closed())
          })
      })
    })
  })
}

// A home per run: the anonymous id and the audit log land in it.
function runBuild(projectDir: string, port: number) {
  return runCli(['build', projectDir, '--browser=chromium'], {
    telemetry: true,
    home: freshCliHome(),
    env: {
      POSTHOG_HOST: `http://127.0.0.1:${port}`,
      POSTHOG_KEY: 'phc_no_location',
      EXTENSION_TELEMETRY: '1',
      EXTENSION_TELEMETRY_SAMPLE_RATE: '1',
      EXTENSION_TELEMETRY_TIMEOUT_MS: '5000'
    }
  })
}

describe('a build run asks the collector for no location', () => {
  const cleanups: Array<() => Promise<void> | void> = []

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup()
  })

  it('posts command_executed with a null $ip and $geoip_disable on', async () => {
    const server = await startCaptureServer()
    cleanups.push(server.close)

    const projectDir = createFixture()
    cleanups.push(() => fs.rmSync(projectDir, {recursive: true, force: true}))

    const result = await runBuild(projectDir, server.port)

    expect(result.status, result.output).toBe(0)
    expect(server.events.map((event) => event.event)).toEqual([
      'command_executed'
    ])

    for (const event of server.events) {
      expect(event.properties.command).toBe('build')
      expect(event.properties.$ip).toBeNull()
      expect(event.properties.$geoip_disable).toBe(true)
    }
  }, 120_000)

  it('posts command_failed with the same two properties', async () => {
    const server = await startCaptureServer()
    cleanups.push(server.close)

    const projectDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'extjs-no-location-empty-')
    )
    cleanups.push(() => fs.rmSync(projectDir, {recursive: true, force: true}))

    const result = await runBuild(projectDir, server.port)

    expect(result.status, result.output).toBe(1)
    const failed = server.events.filter(
      (event) => event.event === 'command_failed'
    )
    expect(failed).toHaveLength(1)
    expect(failed[0].properties.code).toBe('E_MANIFEST_NOT_FOUND')
    expect(server.events).toHaveLength(1)

    for (const event of server.events) {
      expect(event.properties.$ip).toBeNull()
      expect(event.properties.$geoip_disable).toBe(true)
    }
  }, 120_000)
})
