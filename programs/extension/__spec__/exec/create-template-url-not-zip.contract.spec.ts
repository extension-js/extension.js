import fs from 'node:fs'
import http from 'node:http'
import {afterEach, describe, expect, it} from 'vitest'
import {freshCliHome, runCli} from '../helpers/run-cli'
import {trackTempFolders} from '../helpers/temp-folders'

const makeTempFolder = trackTempFolders()

const STACK_FRAME = /^\s+at /m

type Reply = {status?: number; contentType?: string; body: string | Buffer}

function serve(reply: Reply): Promise<{
  origin: string
  close: () => Promise<void>
}> {
  const server = http.createServer((_req, res) => {
    res.writeHead(
      reply.status ?? 200,
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

async function runCreate(
  args: string[],
  extraEnv: Record<string, string> = {}
) {
  const work = makeTempFolder('extjs-create-notzip-')
  const run = await runCli(['create', ...args], {
    cwd: work,
    home: freshCliHome(),
    env: {EXTENSION_ALLOW_HTTP_TEMPLATE: 'true', ...extraEnv}
  })

  return {
    status: run.status,
    stdout: run.stdout,
    stderr: run.stderr,
    leftBehind: fs.readdirSync(work)
  }
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

  // The page and the refused connection under json are read beside develop's
  // answer to the same request, in remote-archive-codes.contract.spec.ts.
  it('codes an empty body sent as a ZIP as E_REMOTE_ZIP_INVALID', async () => {
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

// The bundled template stands in for the default catalog on a machine with no
// network. An override is set on purpose, so every way it fails is reported
// against it and none of them scaffolds something else.
describe('create with a catalog override URL that fails, and no --template', () => {
  let close: (() => Promise<void>) | undefined

  afterEach(async () => {
    if (close) await close()

    close = undefined
  })

  it.each([
    [
      'a page',
      async () => {
        const server = await serve({
          contentType: 'text/html; charset=utf-8',
          body: '<!doctype html><html><body>Sign in</body></html>'
        })
        close = server.close

        return server.origin
      },
      'E_REMOTE_ZIP_INVALID'
    ],
    [
      'a damaged archive',
      async () => {
        const server = await serve({
          contentType: 'application/zip',
          body: DAMAGED_ARCHIVE
        })
        close = server.close

        return server.origin
      },
      'E_REMOTE_ZIP_INVALID'
    ],
    [
      'a 404',
      async () => {
        const server = await serve({status: 404, body: 'not here'})
        close = server.close

        return server.origin
      },
      'E_NETWORK'
    ],
    ['a refused connection', refusedOrigin, 'E_NETWORK']
  ])(
    'refuses %s with its code and names the variable',
    async (_label, origin, code) => {
      const override = `${await origin()}/catalog.zip`

      const result = await runCreate(['./proof', '--output', 'json'], {
        EXTENSION_CREATE_TEMPLATE_URL: override
      })

      expect(result.status, result.stdout + result.stderr).toBe(1)
      expect(result.stderr).not.toMatch(STACK_FRAME)
      expect(result.stdout + result.stderr).not.toContain('offline')

      const frame = onlyFrame(result.stdout)
      expect(frame).toMatchObject({ok: false, command: 'create'})
      expect(frame.error.code).toBe(code)
      expect(frame.error.message).toContain(`URL ${override}`)
      expect(frame.error.message).toContain('EXTENSION_CREATE_TEMPLATE_URL')
      expect(result.leftBehind).toEqual([])
    },
    60000
  )
})
