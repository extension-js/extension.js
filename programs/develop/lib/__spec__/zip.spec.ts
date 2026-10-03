import * as fs from 'node:fs'
import * as http from 'node:http'
import os from 'node:os'
import * as path from 'node:path'
import {strToU8, zipSync} from 'fflate'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {downloadAndExtractZip, extractLocalZip} from '../zip'

const created: string[] = []
const servers: http.Server[] = []

function makeTempDir(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  created.push(dir)

  return dir
}

// Serves whatever the current handler returns on 127.0.0.1, so nothing in
// these specs leaves the process or writes outside the temp dir.
async function serve(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void
): Promise<string> {
  const server = http.createServer(handler)
  servers.push(server)

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })

  const address = server.address() as {port: number}

  return `http://127.0.0.1:${address.port}`
}

function sendZip(res: http.ServerResponse, files: Record<string, string>) {
  const body = Buffer.from(
    zipSync(
      Object.fromEntries(
        Object.entries(files).map(([name, content]) => [name, strToU8(content)])
      )
    )
  )

  res.writeHead(200, {'content-type': 'application/zip'})
  res.end(body)
}

let logSpy: ReturnType<typeof vi.spyOn>
let errorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(async () => {
  for (const server of servers) {
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
    })
  }

  servers.length = 0
})

afterEach(() => {
  vi.restoreAllMocks()

  for (const d of created) {
    try {
      fs.rmSync(d, {recursive: true, force: true})
    } catch {
      // Ignore
    }
  }

  created.length = 0
})

describe('extractLocalZip', () => {
  it('extracts a real local .zip into <target>/<basename>', async () => {
    const root = makeTempDir('extjs-zip-ok-')
    const zipPath = path.join(root, 'my-extension.zip')
    fs.writeFileSync(
      zipPath,
      Buffer.from(zipSync({'manifest.json': strToU8('{"name":"x"}')}))
    )

    const target = makeTempDir('extjs-zip-out-')
    const dest = await extractLocalZip(zipPath, target)

    expect(dest).toBe(path.join(target, 'my-extension'))
    expect(fs.existsSync(path.join(dest, 'manifest.json'))).toBe(true)
  })

  it('rejects an HTML login page disguised as a .zip with a clear message', async () => {
    const root = makeTempDir('extjs-zip-html-')
    const zipPath = path.join(root, 'login.zip')
    fs.writeFileSync(zipPath, '<!DOCTYPE html><html>Sign in to Slack</html>')

    const target = makeTempDir('extjs-zip-html-out-')
    await expect(extractLocalZip(zipPath, target)).rejects.toThrow(
      /isn't a ZIP archive/i
    )
  })

  it('replaces its own earlier extraction of the same archive', async () => {
    const root = makeTempDir('extjs-zip-again-')
    const zipPath = path.join(root, 'my-extension.zip')
    const target = makeTempDir('extjs-zip-again-out-')

    fs.writeFileSync(zipPath, Buffer.from(zipSync({'old.js': strToU8('1')})))
    await extractLocalZip(zipPath, target)

    fs.writeFileSync(zipPath, Buffer.from(zipSync({'new.js': strToU8('2')})))
    const dest = await extractLocalZip(zipPath, target)

    expect(fs.existsSync(path.join(dest, 'new.js'))).toBe(true)
    expect(fs.existsSync(path.join(dest, 'old.js'))).toBe(false)
  })

  // The extraction replaces its destination, so a folder that only shares
  // the archive's name has to survive it untouched.
  it('refuses a same-named folder it did not extract', async () => {
    const root = makeTempDir('extjs-zip-local-stranger-')
    const zipPath = path.join(root, 'my-extension.zip')
    fs.writeFileSync(
      zipPath,
      Buffer.from(zipSync({'manifest.json': strToU8('{"name":"x"}')}))
    )

    const target = makeTempDir('extjs-zip-local-stranger-out-')
    const stranger = path.join(target, 'my-extension')
    fs.mkdirSync(stranger)
    fs.writeFileSync(path.join(stranger, 'keep-me.txt'), 'local work')

    const error = await extractLocalZip(zipPath, target).then(
      () => undefined,
      (reason: Error) => reason
    )

    expect(error?.message).toMatch(/wasn't extracted from this ZIP file/i)
    expect(error?.message).not.toMatch(/Couldn't download or extract/i)
    expect(fs.readdirSync(stranger)).toEqual(['keep-me.txt'])
  })

  it('rejects a missing file', async () => {
    const target = makeTempDir('extjs-zip-missing-')
    await expect(
      extractLocalZip(path.join(target, 'nope.zip'), target)
    ).rejects.toThrow(/not found/i)
  })
})

// The refresh policy for an archive-shaped source: a .zip url names a single
// artifact, so it is refetched every run and the tree is replaced, which is
// also the only way a file deleted upstream stops shipping.
describe('downloadAndExtractZip', () => {
  it('replaces the previous extraction instead of merging into it', async () => {
    const target = makeTempDir('extjs-zip-refetch-')
    let version = 1
    const origin = await serve((_req, res) => {
      if (version === 1) {
        sendZip(res, {
          'manifest.json': '{"version":"1.0.0"}',
          'public/leaked.txt': 'deleted upstream',
          'gone.js': 'export const gone = true'
        })

        return
      }

      sendZip(res, {'manifest.json': '{"version":"2.0.0"}'})
    })

    // The same url twice: provenance is url-keyed, so this is one source
    // whose content changed, which is exactly the case that leaked files.
    const url = `${origin}/examples.zip`
    const first = await downloadAndExtractZip(url, target)
    expect(fs.existsSync(path.join(first, 'public', 'leaked.txt'))).toBe(true)

    version = 2
    const second = await downloadAndExtractZip(url, target)

    expect(second).toBe(first)
    expect(fs.readFileSync(path.join(second, 'manifest.json'), 'utf-8')).toBe(
      '{"version":"2.0.0"}'
    )

    expect(fs.existsSync(path.join(second, 'public', 'leaked.txt'))).toBe(false)
    expect(fs.existsSync(path.join(second, 'gone.js'))).toBe(false)
  })

  it('refuses an archive with an entry outside its folder and writes nothing', async () => {
    const target = makeTempDir('extjs-zip-partial-')
    const origin = await serve((_req, res) => {
      // The second entry escapes, after a first one that is fine: nothing of
      // the archive may land, and the refusal is the archive's, not the network's.
      sendZip(res, {
        'written-first.txt': 'landed',
        '../escapes.txt': 'hostile'
      })
    })

    const url = `${origin}/examples.zip`
    const error = await downloadAndExtractZip(url, target).then(
      () => undefined,
      (reason: Error & {code?: string}) => reason
    )

    expect(error?.code).toBe('E_REMOTE_ZIP_INVALID')
    expect(error?.message).toMatch(/Refusing to extract zip entry/i)
    expect(error?.message).not.toMatch(/Couldn't download or extract/i)

    expect(fs.existsSync(path.join(target, 'examples'))).toBe(false)
    expect(fs.readdirSync(target)).toEqual([])
  })

  it('refuses a destination it never recorded as this url download', async () => {
    const target = makeTempDir('extjs-zip-stranger-')
    const stranger = path.join(target, 'examples')
    fs.mkdirSync(stranger, {recursive: true})
    fs.writeFileSync(path.join(stranger, 'keep-me.txt'), 'local work')

    const origin = await serve((_req, res) => {
      sendZip(res, {'manifest.json': '{}'})
    })

    const error = await downloadAndExtractZip(
      `${origin}/examples.zip`,
      target
    ).then(
      () => undefined,
      (reason: Error) => reason
    )

    // The refusal is its own block, not the reason line of a download failure.
    expect(error?.message).toMatch(/isn't a download from this URL/i)
    expect(error?.message).not.toMatch(/Couldn't download or extract/i)
    expect(fs.readdirSync(stranger)).toEqual(['keep-me.txt'])
  })

  it('renders a failure block exactly once', async () => {
    const target = makeTempDir('extjs-zip-once-')
    const origin = await serve((_req, res) => {
      res.writeHead(404, {'content-type': 'text/plain'})
      res.end('nope')
    })

    let thrown: unknown

    try {
      await downloadAndExtractZip(`${origin}/examples.zip`, target)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(Error)

    const printedByTheCli = (thrown as Error).message
    const printedHere = [...logSpy.mock.calls, ...errorSpy.mock.calls]
      .map((call) => String(call[0]))
      .join('\n')

    const needle = "Couldn't download or extract the ZIP file."
    const haystack = `${printedHere}\n${printedByTheCli}`

    expect(haystack.split(needle).length - 1).toBe(1)
  })
})

// One cause, one code: a reply that is not an archive and an archive that
// will not unpack are the URL's to fix, a failed transport is not.
describe('the code a remote archive failure carries', () => {
  const damaged = Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from('cut short on the way down '.repeat(8))
  ])

  async function failure(
    handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
    name = 'examples.zip'
  ) {
    const origin = await serve(handler)
    const target = makeTempDir('extjs-zip-code-')
    const error = await downloadAndExtractZip(`${origin}/${name}`, target).then(
      () => undefined,
      (reason: Error & {code?: string}) => reason
    )

    expect(fs.readdirSync(target)).toEqual([])

    return {code: error?.code, message: String(error?.message)}
  }

  it.each([
    [
      'a page behind a .zip name',
      'examples.zip',
      'text/html; charset=utf-8',
      Buffer.from('<!doctype html><html>Sign in</html>'),
      /isn't a ZIP archive/
    ],
    [
      'a page with no ZIP name or type',
      'download',
      'text/html',
      Buffer.from('<html>Sign in</html>'),
      /doesn't point to a ZIP archive/
    ],
    [
      'an archive that will not unpack',
      'examples.zip',
      'application/zip',
      damaged,
      /The ZIP archive at the remote URL is damaged\.[\s\S]*invalid zip data/
    ]
  ])('is E_REMOTE_ZIP_INVALID for %s, as its own block', async (_label, name, type, body, sentence) => {
    const {code, message} = await failure((_req, res) => {
      res.writeHead(200, {'content-type': type})
      res.end(body)
    }, name)

    expect(code).toBe('E_REMOTE_ZIP_INVALID')
    expect(message).toMatch(sentence)
    expect(message).not.toMatch(/Couldn't download or extract/)
    expect(message.match(/⏵⏵⏵/g)).toHaveLength(1)
  })

  it('stays E_REMOTE_DOWNLOAD when the server answers 404', async () => {
    const {code, message} = await failure((_req, res) => {
      res.writeHead(404)
      res.end('nope')
    })

    expect(code).toBe('E_REMOTE_DOWNLOAD')
    expect(message).toMatch(/Couldn't download or extract/)
  })

  it('gives a local file that will not unpack its own block, with no URL advice', async () => {
    const root = makeTempDir('extjs-zip-local-')
    const zipPath = path.join(root, 'cut.zip')
    fs.writeFileSync(zipPath, damaged)

    const error = await extractLocalZip(
      zipPath,
      makeTempDir('extjs-zip-local-out-')
    ).then(
      () => undefined,
      (reason: Error & {code?: string}) => reason
    )

    expect(error?.code).toBe('E_LOCAL_ZIP_NOT_FOUND')
    expect(error?.message).toMatch(/isn't a ZIP archive that can be unpacked/)
    expect(error?.message).toContain('invalid zip data')
    expect(error?.message).not.toMatch(/network|login page/i)
  })
})

// stdout is the machine's under json, so the lines about the download move
// to stderr there and stay on stdout for a person.
describe('the human lines around a remote fetch', () => {
  const priorOutput = process.env.EXTENSION_OUTPUT

  afterEach(() => {
    if (priorOutput === undefined) delete process.env.EXTENSION_OUTPUT
    else process.env.EXTENSION_OUTPUT = priorOutput
  })

  async function fetchOnce() {
    const origin = await serve((_req, res) => {
      sendZip(res, {'manifest.json': '{}'})
    })

    await downloadAndExtractZip(
      `${origin}/examples.zip`,
      makeTempDir('extjs-zip-lines-')
    )
  }

  it('go to stderr in machine mode and leave stdout alone', async () => {
    process.env.EXTENSION_OUTPUT = 'json'
    const stderr = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true)
    const stdout = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true)

    await fetchOnce()

    const written = stderr.mock.calls.map((call) => String(call[0])).join('')
    expect(written).toContain('Downloading the browser extension')
    expect(written).toContain('Unpackaging the browser extension')
    expect(written).toContain('Extension unpackaged.')
    expect(stdout).not.toHaveBeenCalled()
    expect(logSpy).not.toHaveBeenCalled()
  })

  it('stay on stdout for a person', async () => {
    delete process.env.EXTENSION_OUTPUT

    await fetchOnce()

    const printed = logSpy.mock.calls
      .map((call: unknown[]) => String(call[0]))
      .join('\n')
    expect(printed).toContain('Downloading the browser extension')
    expect(printed).toContain('Extension unpackaged.')
  })
})
