import {spawn} from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'

const ANSI = /\x1b\[[0-9;]*m/g
const STACK_FRAME = /^\s+at /m

function cliBin(): string {
  return path.resolve(__dirname, '../..', 'dist', 'cli.cjs')
}

type Reply = {contentType?: string; body: string | Buffer}

function serve(reply: Reply): Promise<{
  origin: string
  close: () => Promise<void>
}> {
  const server = http.createServer((_req, res) => {
    res.writeHead(
      200,
      reply.contentType ? {'content-type': reply.contentType} : {}
    )

    res.end(reply.body)
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0

      resolve({
        origin: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done())
          })
      })
    })
  })
}

// A port nothing listens on: bound once so the system picked a free one,
// then released, so the connection is refused instead of answered.
async function refusedOrigin(): Promise<string> {
  const server = await serve({body: ''})
  await server.close()

  return server.origin
}

function runCreate(
  args: string[],
  extraEnv: Record<string, string> = {}
): Promise<{
  status: number | null
  stdout: string
  stderr: string
  leftBehind: string[]
}> {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-create-notzip-'))
  const configHome = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-config-'))
  const cacheHome = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-cache-'))

  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    const child = spawn(process.execPath, [cliBin(), 'create', ...args], {
      cwd: work,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        NO_COLOR: '1',
        FORCE_COLOR: '0',
        EXTENSION_ENV: 'test',
        EXTENSION_TELEMETRY: '0',
        EXTENSION_ALLOW_HTTP_TEMPLATE: 'true',
        XDG_CONFIG_HOME: configHome,
        XDG_CACHE_HOME: cacheHome,
        ...extraEnv
      }
    })
    child.stdout.on('data', (chunk) => (stdout += chunk.toString()))
    child.stderr.on('data', (chunk) => (stderr += chunk.toString()))

    child.on('close', (status) => {
      const leftBehind = fs.readdirSync(work)

      for (const dir of [work, configHome, cacheHome]) {
        fs.rmSync(dir, {recursive: true, force: true})
      }

      resolve({
        status,
        stdout: stdout.replace(ANSI, ''),
        stderr: stderr.replace(ANSI, ''),
        leftBehind
      })
    })
  })
}

function onlyFrame(stdout: string): {
  ok: boolean
  command: string
  status: string
  error: {code: string; message: string}
} {
  const lines = stdout.split('\n').filter((line) => line.trim())
  expect(lines, stdout).toHaveLength(1)

  return JSON.parse(lines[0])
}

describe('create with a template URL that does not answer with a ZIP', () => {
  let close: (() => Promise<void>) | undefined

  afterEach(async () => {
    if (close) await close()

    close = undefined
  })

  it('names the page it got behind a .zip name, in one frame with no stack', async () => {
    const server = await serve({
      contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><html><body>Sign in</body></html>'
    })
    close = server.close
    const url = `${server.origin}/template.zip`

    const result = await runCreate(['./proof', '-t', url])

    expect(result.status, result.stderr).toBe(1)
    expect(result.stderr).not.toMatch(STACK_FRAME)
    expect(result.stderr).not.toContain('invalid zip data')
    expect(result.stderr.match(/⏵⏵⏵/g), result.stderr).toHaveLength(1)
    expect(result.stderr).toContain(
      "The remote URL doesn't point to a ZIP archive."
    )

    expect(result.stderr).toContain(`URL ${url}`)
    expect(result.stderr).toContain('GOT text/html; charset=utf-8')
    expect(result.stderr).toContain('Use a direct-download URL')
    expect(result.leftBehind).toEqual([])
  }, 60000)

  it('codes the page E_REMOTE_ZIP_INVALID under --output json', async () => {
    const server = await serve({
      contentType: 'text/html',
      body: '<html>not here</html>'
    })
    close = server.close

    const result = await runCreate([
      './proof',
      '-t',
      `${server.origin}/template.zip`,
      '--output',
      'json'
    ])

    expect(result.status, result.stderr).toBe(1)
    expect(result.stderr).not.toMatch(STACK_FRAME)

    const frame = onlyFrame(result.stdout)
    expect(frame).toMatchObject({ok: false, command: 'create'})
    expect(frame.error.code).toBe('E_REMOTE_ZIP_INVALID')
    expect(frame.error.message).toContain("doesn't point to a ZIP archive")
    expect(frame.error.message).toContain('GOT text/html')
  }, 60000)

  it('codes an empty body sent as a ZIP the same way', async () => {
    const server = await serve({contentType: 'application/zip', body: ''})
    close = server.close

    const result = await runCreate([
      './proof',
      '-t',
      `${server.origin}/download`,
      '--output',
      'json'
    ])

    expect(result.status, result.stderr).toBe(1)
    expect(result.stderr).not.toMatch(STACK_FRAME)
    expect(result.stderr).not.toContain('invalid zip data')

    const frame = onlyFrame(result.stdout)
    expect(frame.error.code).toBe('E_REMOTE_ZIP_INVALID')
    expect(frame.error.message).toContain(
      'GOT application/zip with an empty body'
    )
  }, 60000)

  // The other side of the line: nothing answered, so this stays a network
  // failure and never borrows the not-a-ZIP frame.
  it('keeps the network code when the connection is refused', async () => {
    const origin = await refusedOrigin()

    const result = await runCreate([
      './proof',
      '-t',
      `${origin}/template.zip`,
      '--output',
      'json'
    ])

    expect(result.status, result.stderr).toBe(1)
    expect(result.stderr).not.toMatch(STACK_FRAME)

    const frame = onlyFrame(result.stdout)
    expect(frame.error.code).toBe('E_NETWORK')
    expect(frame.error.message).toContain(
      "Couldn't fetch the template from that URL"
    )

    expect(frame.error.message).toContain('ECONNREFUSED')
    expect(frame.error.message).not.toContain('ZIP archive')
  }, 60000)
})

// The right signature over a body that will not unpack. The first bytes pass,
// so the unzip is where this fails.
const DAMAGED_ARCHIVE = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from('cut short on the way down '.repeat(8))
])

describe('create with a remote archive the unzip cannot read', () => {
  let close: (() => Promise<void>) | undefined

  afterEach(async () => {
    if (close) await close()

    close = undefined
  })

  it('says the archive is damaged, in one frame with no stack', async () => {
    const server = await serve({
      contentType: 'application/zip',
      body: DAMAGED_ARCHIVE
    })
    close = server.close
    const url = `${server.origin}/template.zip`

    const result = await runCreate(['./proof', '-t', url])

    expect(result.status, result.stderr).toBe(1)
    expect(result.stderr).not.toMatch(STACK_FRAME)
    expect(result.stderr.match(/⏵⏵⏵/g), result.stderr).toHaveLength(1)
    expect(result.stderr).toContain(
      'The ZIP archive at the remote URL is damaged.'
    )

    expect(result.stderr).toContain(`URL ${url}`)
    expect(result.stderr).toContain('REASON invalid zip data')
    expect(result.leftBehind).toEqual([])
  }, 60000)

  it('codes it E_REMOTE_ZIP_INVALID under --output json', async () => {
    const server = await serve({
      contentType: 'application/zip',
      body: DAMAGED_ARCHIVE
    })
    close = server.close

    const result = await runCreate([
      './proof',
      '-t',
      `${server.origin}/template.zip`,
      '--output',
      'json'
    ])

    expect(result.status, result.stderr).toBe(1)
    expect(result.stderr).not.toMatch(STACK_FRAME)

    const frame = onlyFrame(result.stdout)
    expect(frame).toMatchObject({ok: false, command: 'create'})
    expect(frame.error.code).toBe('E_REMOTE_ZIP_INVALID')
    expect(frame.error.message).toContain('is damaged')
    expect(frame.error.message).not.toContain('⏵')
  }, 60000)
})

// EXTENSION_CREATE_TEMPLATE_URL swaps the catalog archive for a URL someone
// typed, so its reply is held to the same two tests.
describe('create with a catalog override URL that is not a good archive', () => {
  let close: (() => Promise<void>) | undefined

  afterEach(async () => {
    if (close) await close()

    close = undefined
  })

  it('codes a page E_REMOTE_ZIP_INVALID and names the override', async () => {
    const server = await serve({
      contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><html><body>Sign in</body></html>'
    })
    close = server.close
    const override = `${server.origin}/catalog.zip`

    const result = await runCreate(
      ['./proof', '-t', 'react', '--output', 'json'],
      {EXTENSION_CREATE_TEMPLATE_URL: override}
    )

    expect(result.status, result.stderr).toBe(1)
    expect(result.stderr).not.toMatch(STACK_FRAME)
    expect(result.stderr).not.toContain('invalid zip data')

    const frame = onlyFrame(result.stdout)
    expect(frame.error.code).toBe('E_REMOTE_ZIP_INVALID')
    expect(frame.error.message).toContain("doesn't point to a ZIP archive")
    expect(frame.error.message).toContain(`URL ${override}`)
    expect(frame.error.message).toContain('GOT text/html')
    expect(result.leftBehind).toEqual([])
  }, 60000)

  it('codes a damaged archive the same way', async () => {
    const server = await serve({
      contentType: 'application/zip',
      body: DAMAGED_ARCHIVE
    })
    close = server.close
    const override = `${server.origin}/catalog.zip`

    const result = await runCreate(
      ['./proof', '-t', 'react', '--output', 'json'],
      {EXTENSION_CREATE_TEMPLATE_URL: override}
    )

    expect(result.status, result.stderr).toBe(1)
    expect(result.stderr).not.toMatch(STACK_FRAME)

    const frame = onlyFrame(result.stdout)
    expect(frame.error.code).toBe('E_REMOTE_ZIP_INVALID')
    expect(frame.error.message).toContain('is damaged')
    expect(frame.error.message).toContain(`URL ${override}`)
    expect(result.leftBehind).toEqual([])
  }, 60000)
})
