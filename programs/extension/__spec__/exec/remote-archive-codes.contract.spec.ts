import {spawn} from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import {createRequire} from 'node:module'
import os from 'node:os'
import path from 'node:path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

const cliBin = path.resolve(__dirname, '../..', 'dist', 'cli.cjs')
const STACK_FRAME = /^\s+at /m

// The archive library belongs to develop, which is where a spec here finds it.
const {zipSync, strToU8} = createRequire(
  path.resolve(__dirname, '../../../develop/package.json')
)('fflate') as {
  zipSync: (files: Record<string, Uint8Array>) => Uint8Array
  strToU8: (text: string) => Uint8Array
}

const GOOD_ARCHIVE = Buffer.from(
  zipSync({
    'manifest.json': strToU8(
      JSON.stringify({
        manifest_version: 3,
        name: 'Remote Probe',
        version: '1.0.0'
      })
    )
  })
)

// Opens fine, then names a file outside the folder it unpacks into.
const ESCAPING_ARCHIVE = Buffer.from(
  zipSync({
    'manifest.json': strToU8('{}'),
    '../escaped.txt': strToU8('hostile')
  })
)

// The right signature over a body that will not unpack.
const DAMAGED_ARCHIVE = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from('cut short on the way down '.repeat(8))
])

interface Frame {
  ok: boolean
  command: string
  status: string
  error: {code: string; message: string} | null
}

interface Run {
  status: number | null
  stdout: string
  stderr: string
}

describe('a remote archive, read by create and by develop', () => {
  let server: http.Server
  let origin = ''
  let refused = ''
  let work = ''
  const homes: string[] = []

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = String(req.url)

      if (url.startsWith('/good/')) {
        res.writeHead(200, {'content-type': 'application/zip'})
        res.end(GOOD_ARCHIVE)
      } else if (url.startsWith('/page/')) {
        res.writeHead(200, {'content-type': 'text/html; charset=utf-8'})
        res.end('<!doctype html><html><body>Sign in</body></html>')
      } else if (url.startsWith('/escaping/')) {
        res.writeHead(200, {'content-type': 'application/zip'})
        res.end(ESCAPING_ARCHIVE)
      } else if (url.startsWith('/damaged/')) {
        res.writeHead(200, {'content-type': 'application/zip'})
        res.end(DAMAGED_ARCHIVE)
      } else if (url.startsWith('/slow/')) {
        // Never answered: the caller's own timeout has to end it.
      } else {
        res.writeHead(404)
        res.end('not here')
      }
    })

    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', () => resolve())
    )

    const address = server.address()
    origin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`

    // A port nothing listens on: bound once so the system picked a free one,
    // then released, so the connection is refused instead of answered.
    const probe = http.createServer()
    await new Promise<void>((resolve) =>
      probe.listen(0, '127.0.0.1', () => resolve())
    )

    const probeAddress = probe.address()
    refused = `http://127.0.0.1:${typeof probeAddress === 'object' && probeAddress ? probeAddress.port : 0}`
    await new Promise<void>((resolve) => probe.close(() => resolve()))

    work = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-remote-codes-'))
    )
  })

  afterAll(async () => {
    server.closeAllConnections?.()
    await new Promise<void>((resolve) => server.close(() => resolve()))

    for (const dir of [work, ...homes]) {
      fs.rmSync(dir, {recursive: true, force: true})
    }
  })

  function runCli(
    args: string[],
    options: {env?: Record<string, string>; stopOnFrame?: string} = {}
  ): Promise<Run> {
    const configHome = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-config-'))
    const cacheHome = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-cache-'))
    homes.push(configHome, cacheHome)

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NO_COLOR: '1',
      FORCE_COLOR: '0',
      EXTENSION_ENV: 'test',
      EXTENSION_TELEMETRY: '0',
      EXTENSION_ALLOW_HTTP_TEMPLATE: 'true',
      XDG_CONFIG_HOME: configHome,
      XDG_CACHE_HOME: cacheHome,
      ...options.env
    }
    delete env.VITEST
    delete env.VITEST_WORKER_ID

    return new Promise((resolve, reject) => {
      let stdout = ''
      let stderr = ''
      const child = spawn(process.execPath, [cliBin, ...args], {
        cwd: work,
        stdio: ['ignore', 'pipe', 'pipe'],
        env
      })

      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        reject(new Error(`CLI did not exit: ${args.join(' ')}\n${stdout}`))
      }, 100_000)

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString()

        // A dev session never ends by itself, so it is stopped once the frame
        // the case waits for is on stdout.
        if (
          options.stopOnFrame &&
          stdout.includes(`"status":"${options.stopOnFrame}"`)
        ) {
          child.kill('SIGTERM')
        }
      })

      child.stderr.on('data', (chunk) => (stderr += chunk.toString()))

      child.on('close', (status) => {
        clearTimeout(timer)
        resolve({status, stdout, stderr})
      })
    })
  }

  // stdout as a whole: a human line beside the frame fails the parse.
  function onlyFrame(run: Run): Frame {
    return JSON.parse(run.stdout) as Frame
  }

  let seq = 0

  // One fixture, both packages. Each run gets its own archive name, because
  // develop unpacks into a folder named after it.
  async function codes(route: string, env: Record<string, string> = {}) {
    seq += 1

    const created = await runCli(
      [
        'create',
        `./created-${seq}`,
        '-t',
        `${route}/template-${seq}.zip`,
        '--output',
        'json'
      ],
      {env}
    )
    const built = await runCli(
      ['build', `${route}/extension-${seq}.zip`, '--output', 'json'],
      {env}
    )

    for (const run of [created, built]) {
      expect(run.status, run.stdout + run.stderr).toBe(1)
      expect(run.stderr).not.toMatch(STACK_FRAME)
      expect(onlyFrame(run).error?.message).not.toContain('⏵')
    }

    expect(onlyFrame(built).status).toBe('build-failed')

    return {
      create: onlyFrame(created).error?.code,
      develop: onlyFrame(built).error?.code,
      createMessage: String(onlyFrame(created).error?.message),
      developMessage: String(onlyFrame(built).error?.message)
    }
  }

  it('codes a reply that is not a ZIP the same in both', async () => {
    const result = await codes(`${origin}/page`)

    expect(result.create).toBe('E_REMOTE_ZIP_INVALID')
    expect(result.develop).toBe('E_REMOTE_ZIP_INVALID')
    expect(result.createMessage).toContain('GOT text/html')
    expect(result.developMessage).toContain('GOT text/html')
    // The refusal is its own block, not the reason line of a download one.
    expect(result.developMessage).not.toContain("Couldn't download or extract")
  }, 120_000)

  it('codes a damaged archive the same in both', async () => {
    const result = await codes(`${origin}/damaged`)

    expect(result.create).toBe('E_REMOTE_ZIP_INVALID')
    expect(result.develop).toBe('E_REMOTE_ZIP_INVALID')

    for (const message of [result.createMessage, result.developMessage]) {
      expect(message).toContain('The ZIP archive at the remote URL is damaged.')
      expect(message).toContain('REASON invalid zip data')
    }
  }, 120_000)

  // Neither package unpacks it, and neither calls it a network failure.
  it('codes an archive with an entry outside its folder the same in both', async () => {
    const result = await codes(`${origin}/escaping`)

    expect(result.create).toBe('E_REMOTE_ZIP_INVALID')
    expect(result.develop).toBe('E_REMOTE_ZIP_INVALID')

    for (const message of [result.createMessage, result.developMessage]) {
      expect(message).toContain('../escaped.txt')
    }

    expect(fs.existsSync(path.join(work, 'escaped.txt'))).toBe(false)
  }, 120_000)

  // The other side of the line: nothing usable answered, so each package
  // keeps the transport code it already had and never borrows the ZIP one.
  it.each([
    ['a refused connection', () => refused],
    ['a 404', () => `${origin}/missing`]
  ])(
    'keeps the transport codes for %s',
    async (_label, route) => {
      const result = await codes(route())

      expect(result.create).toBe('E_NETWORK')
      expect(result.develop).toBe('E_REMOTE_DOWNLOAD')
    },
    120_000
  )

  it('codes a fetch that outlives its timeout in develop', async () => {
    const run = await runCli(
      ['build', `${origin}/slow/extension.zip`, '--output', 'json'],
      {env: {EXTENSION_FETCH_TIMEOUT_MS: '1500'}}
    )

    expect(run.status, run.stdout + run.stderr).toBe(1)
    expect(run.stderr).not.toMatch(STACK_FRAME)
    expect(onlyFrame(run).error?.code).toBe('E_REMOTE_FETCH_TIMEOUT')
  }, 120_000)

  // A remote that could not be fetched or unpacked is a run that failed, the
  // status dev gives it too, and never a usage error.
  it.each([
    [
      'a reply that is not a ZIP',
      () => `${origin}/page`,
      'E_REMOTE_ZIP_INVALID'
    ],
    ['a damaged archive', () => `${origin}/damaged`, 'E_REMOTE_ZIP_INVALID'],
    ['a 404', () => `${origin}/missing`, 'E_REMOTE_DOWNLOAD'],
    ['a refused connection', () => refused, 'E_REMOTE_DOWNLOAD'],
    [
      'a fetch past its timeout',
      () => `${origin}/slow`,
      'E_REMOTE_FETCH_TIMEOUT'
    ]
  ])(
    'preview reports %s as failed with its code',
    async (_label, route, code) => {
      seq += 1

      const run = await runCli(
        [
          'preview',
          `${route()}/previewed-${seq}.zip`,
          '--no-browser',
          '--output',
          'json'
        ],
        {env: {EXTENSION_FETCH_TIMEOUT_MS: '1500'}}
      )

      expect(run.status, run.stdout + run.stderr).toBe(1)
      expect(run.stderr).not.toMatch(STACK_FRAME)
      expect(onlyFrame(run)).toMatchObject({
        ok: false,
        command: 'preview',
        status: 'failed',
        error: {code}
      })
    },
    120_000
  )

  it('refuses a plain http template with its own code and no stack', async () => {
    const run = await runCli(
      [
        'create',
        './created-http',
        '-t',
        'http://example.com/template.zip',
        '--output',
        'json'
      ],
      {env: {EXTENSION_ALLOW_HTTP_TEMPLATE: ''}}
    )

    expect(run.status, run.stdout + run.stderr).toBe(1)
    expect(run.stderr).not.toMatch(STACK_FRAME)

    const frame = onlyFrame(run)
    expect(frame.error?.code).toBe('E_INVALID_OPTION')
    expect(frame.error?.message).toContain(
      "Can't download a template over plain HTTP."
    )

    expect(frame.error?.message).toContain('EXTENSION_ALLOW_HTTP_TEMPLATE=true')
    expect(fs.existsSync(path.join(work, 'created-http'))).toBe(false)
  }, 120_000)

  // The lines about the download are for a person, so under json they go to
  // stderr and stdout stays what a machine parses.
  it('build of a remote archive writes exactly one JSON document to stdout', async () => {
    const run = await runCli([
      'build',
      `${origin}/good/built.zip`,
      '--output',
      'json'
    ])

    expect(run.status, run.stdout + run.stderr).toBe(0)

    const frame = onlyFrame(run)
    expect(frame).toMatchObject({ok: true, command: 'build', status: 'built'})
    expect(run.stderr).toContain('Downloading the browser extension')
    expect(run.stderr).toContain('Extension unpackaged.')
  }, 120_000)

  it('preview of a remote archive writes exactly one JSON document to stdout', async () => {
    const run = await runCli([
      'preview',
      `${origin}/good/previewed.zip`,
      '--no-browser',
      '--output',
      'json'
    ])

    expect(run.status, run.stdout + run.stderr).toBe(0)
    expect(onlyFrame(run)).toMatchObject({ok: true, command: 'preview'})
    expect(run.stderr).toContain('Downloading the browser extension')
  }, 120_000)

  it('dev of a remote archive writes only frames to stdout, started first', async () => {
    const run = await runCli(
      ['dev', `${origin}/good/watched.zip`, '--no-browser', '--output', 'json'],
      {stopOnFrame: 'ready'}
    )

    const lines = run.stdout.split('\n').filter((line) => line.trim())
    const statuses = lines.map((line) => (JSON.parse(line) as Frame).status)

    expect(statuses.slice(0, 2)).toEqual(['started', 'starting'])
    expect(statuses).toContain('ready')
    expect(run.stderr).toContain('Downloading the browser extension')
  }, 120_000)

  // A refusal that ends the run before a session exists: the failure is the
  // only frame, with no ok "started" ahead of it.
  it.each([
    [
      'a project with no manifest',
      () => {
        const dir = path.join(work, 'no-manifest')
        fs.mkdirSync(dir, {recursive: true})

        return dir
      },
      'E_MANIFEST_NOT_FOUND'
    ],
    [
      'a manifest that is not JSON',
      () => {
        const dir = path.join(work, 'bad-manifest')
        fs.mkdirSync(dir, {recursive: true})
        fs.writeFileSync(path.join(dir, 'manifest.json'), '{ not json')

        return dir
      },
      'E_MANIFEST_INVALID'
    ],
    [
      'a remote reply that is not a ZIP',
      () => `${origin}/page/dev-page.zip`,
      'E_REMOTE_ZIP_INVALID'
    ],
    [
      'a damaged remote archive',
      () => `${origin}/damaged/dev-damaged.zip`,
      'E_REMOTE_ZIP_INVALID'
    ],
    [
      'a remote archive nothing serves',
      () => `${refused}/dev-refused.zip`,
      'E_REMOTE_DOWNLOAD'
    ]
  ])(
    'dev prints one failure frame and no started frame for %s',
    async (_label, target, code) => {
      const run = await runCli([
        'dev',
        target(),
        '--no-browser',
        '--output',
        'json'
      ])

      expect(run.status, run.stdout + run.stderr).toBe(1)

      const frame = onlyFrame(run)
      expect(frame).toMatchObject({ok: false, command: 'dev', status: 'failed'})
      expect(frame.error?.code).toBe(code)
      expect(frame.error?.message).not.toContain('⏵')
    },
    120_000
  )
})
