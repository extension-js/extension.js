import {spawn} from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import type {AddressInfo} from 'node:net'
import os from 'node:os'
import path from 'node:path'
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it} from 'vitest'

type Reply = {status: number; contentType: string; body: string}
type Seen = {authorization: string; path: string}

function cliRoot(): string {
  return path.resolve(__dirname, '../..')
}

function cliBin(): string {
  const cjs = path.join(cliRoot(), 'dist', 'cli.cjs')
  if (fs.existsSync(cjs)) return cjs

  return path.join(cliRoot(), 'dist', 'cli.js')
}

let server: http.Server
let api = ''
let reply: Reply = {status: 200, contentType: 'application/json', body: '{}'}
let seen: Seen[] = []
let configDir = ''
let projectDir = ''

beforeAll(async () => {
  server = http.createServer((req, res) => {
    seen.push({
      authorization: String(req.headers.authorization || ''),
      path: String(req.url || '')
    })

    req.resume()
    req.on('end', () => {
      res.writeHead(reply.status, {'content-type': reply.contentType})
      res.end(reply.body)
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  api = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

beforeEach(() => {
  seen = []
  configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-publish-reply-cfg-'))
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-publish-reply-proj-'))
  fs.writeFileSync(
    path.join(projectDir, 'package.json'),
    JSON.stringify({name: 'pubwalk', version: '1.0.0'})
  )
})

afterEach(() => {
  fs.rmSync(configDir, {recursive: true, force: true})
  fs.rmSync(projectDir, {recursive: true, force: true})
})

function json(body: unknown): Reply {
  return {
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body)
  }
}

function writeStoredLogin(expiresAt: unknown) {
  const dir = path.join(configDir, 'extension-dev')
  fs.mkdirSync(dir, {recursive: true})
  fs.writeFileSync(
    path.join(dir, 'auth.json'),
    JSON.stringify({version: 1, token: 'tok_expired', expiresAt})
  )
}

function run(args: string[]) {
  return new Promise<{code: number; stdout: string; stderr: string}>(
    (resolve, reject) => {
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        EXTENSION_ENV: 'test',
        XDG_CONFIG_HOME: configDir,
        APPDATA: configDir
      }
      delete env.EXTENSION_DEV_TOKEN
      delete env.EXTENSION_DEV_API_URL
      delete env.EXTENSION_DEV_DOCS_URL
      const child = spawn(
        process.execPath,
        [cliBin(), 'publish', projectDir, '--api', api, ...args],
        {cwd: projectDir, env}
      )
      let stdout = ''
      let stderr = ''
      child.stdout.setEncoding('utf8').on('data', (chunk) => {
        stdout += chunk
      })

      child.stderr.setEncoding('utf8').on('data', (chunk) => {
        stderr += chunk
      })

      child.on('error', reject)
      child.on('close', (code) => resolve({code: code ?? -1, stdout, stderr}))
    }
  )
}

describe('publish against a loopback platform', () => {
  it('writes exactly the share URL and a newline to stdout', async () => {
    reply = json({shareUrl: 'https://ext.dev/s/abc', buildSha: 'abc'})
    const result = await run(['--token', 'tok_fake'])

    expect(result.code).toBe(0)
    expect(result.stdout).toBe('https://ext.dev/s/abc\n')
    expect(result.stderr).toContain('Published pubwalk')
    expect(seen).toEqual([
      {authorization: 'Bearer tok_fake', path: '/api/cli/publish'}
    ])
  })

  it('refuses a 200 with no shareUrl and writes nothing to stdout', async () => {
    reply = json({ok: true, message: 'build queued, no link yet'})
    const result = await run(['--token', 'tok_fake'])

    expect(result.code).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('no share URL')
  })

  it('refuses a partial publish with its own status under --output json', async () => {
    reply = json({shareUrl: null, status: 'partial', failed: ['chrome']})
    const result = await run(['--token', 'tok_fake', '--output', 'json'])

    expect(result.code).toBe(1)
    const frame = JSON.parse(result.stdout.trim())
    expect(frame.ok).toBe(false)
    expect(frame.status).toBe('partial')
    expect(frame.error.code).toBe('E_PUBLISH_REJECTED')
    expect(frame.error.message).toContain('chrome')
  })

  it('refuses a 200 HTML page from a proxy', async () => {
    reply = {
      status: 200,
      contentType: 'text/html',
      body: '<html>bad gateway</html>'
    }

    const result = await run(['--token', 'tok_fake', '--output', 'json'])

    expect(result.code).toBe(1)
    const frame = JSON.parse(result.stdout.trim())
    expect(frame.status).toBe('rejected')
    expect(frame.error.code).toBe('E_PUBLISH_REJECTED')
    expect(frame.error.message).toContain('bad gateway')
  })

  it.each([
    ['an ISO string', '2020-01-01T00:00:00Z'],
    ['a millisecond epoch', 1577836800000]
  ])('sends no request for a stored login expired as %s', async (_, at) => {
    writeStoredLogin(at)
    reply = json({shareUrl: 'https://ext.dev/s/abc'})
    const result = await run(['--output', 'json'])

    expect(result.code).toBe(1)
    const frame = JSON.parse(result.stdout.trim())
    expect(frame.status).toBe('denied')
    expect(frame.error.code).toBe('E_AUTH_REQUIRED')
    expect(seen).toEqual([])
  })
})
