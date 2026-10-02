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

  it('leaves no destination behind when the extract throws partway', async () => {
    const target = makeTempDir('extjs-zip-partial-')
    const origin = await serve((_req, res) => {
      // The zip-slip guard throws on the second entry, after the first is
      // already written: a merge-in-place would strand it on disk.
      sendZip(res, {
        'written-first.txt': 'landed',
        '../escapes.txt': 'hostile'
      })
    })

    const url = `${origin}/examples.zip`
    await expect(downloadAndExtractZip(url, target)).rejects.toThrow(
      /Refusing to extract zip entry/i
    )

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
