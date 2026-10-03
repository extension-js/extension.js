import {spawn} from 'node:child_process'
import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import {createServer, type Server} from 'node:http'
import type {AddressInfo} from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import {strToU8, zipSync} from 'fflate'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {
  DEFAULT_TEMPLATE_NAME,
  importExternalTemplate
} from '../steps/import-external-template'

const noopLogger = {log() {}, error() {}}

describe('the pinned examples catalog still serves the default template', () => {
  let workDir = ''

  beforeEach(async () => {
    workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'extjs-catalog-'))
  })

  afterEach(async () => {
    await fsp.rm(workDir, {recursive: true, force: true})
  })

  it('downloads it from codeload and records the pinned ref', async () => {
    const projectPath = path.join(workDir, 'from-catalog')

    const provenance = await importExternalTemplate(
      projectPath,
      'from-catalog',
      DEFAULT_TEMPLATE_NAME,
      noopLogger
    )

    expect(provenance.template).toBe(DEFAULT_TEMPLATE_NAME)
    expect(provenance.source).toContain('codeload.github.com')
    expect(provenance.ref).toBeTruthy()
    await expect(
      fsp.readFile(path.join(projectPath, 'package.json'), 'utf8')
    ).resolves.toContain('"name"')
  }, 600_000)
})

// The shipped entry, not the source, is what proves a ZIP layout survives
// create. `pnpm test:remote` compiles first, which puts this file in place.
const PACKED_CLI = path.resolve(
  __dirname,
  '..',
  '..',
  'extension',
  'dist',
  'cli.cjs'
)

function makeZip(structure: Record<string, string>): Buffer {
  const entries: Record<string, Uint8Array> = {}

  for (const [name, content] of Object.entries(structure)) {
    entries[name] = strToU8(content)
  }

  return Buffer.from(zipSync(entries))
}

function serveZip(
  archiveName: string,
  zip: Buffer
): Promise<{server: Server; url: string}> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      if (req.url === `/${archiveName}`) {
        res.statusCode = 200
        res.setHeader('Content-Type', 'application/zip')
        res.end(zip)

        return
      }

      res.statusCode = 404
      res.end('not found')
    })

    server.listen(0, '127.0.0.1', () => {
      const {port} = server.address() as AddressInfo
      resolve({server, url: `http://127.0.0.1:${port}/${archiveName}`})
    })
  })
}

type CreateEnvelope = {
  ok: boolean
  value: {projectPath: string; template: string} | null
  error: {code: string; message: string} | null
}

function createFromUrl(
  dest: string,
  templateUrl: string,
  env: Record<string, string> = {}
): Promise<{code: number | null; envelope: CreateEnvelope; stderr: string}> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        PACKED_CLI,
        'create',
        dest,
        '--template',
        templateUrl,
        '--output',
        'json'
      ],
      {
        cwd: path.dirname(dest),
        env: {
          ...process.env,
          EXTENSION_ENV: 'test',
          EXTENSION_SKIP_INTERNAL_INSTALL: 'true',
          EXTENSION_ALLOW_HTTP_TEMPLATE: 'true',
          ...env
        }
      }
    )
    let stdout = ''
    let stderr = ''
    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`timed out creating from ${templateUrl}\n${stderr}`))
    }, 120_000)

    child.stdout.on('data', (chunk) => (stdout += String(chunk)))
    child.stderr.on('data', (chunk) => (stderr += String(chunk)))
    child.on('error', reject)
    child.on('exit', (code) => {
      clearTimeout(timeout)

      const lastLine = stdout.trim().split('\n').pop() ?? ''

      try {
        resolve({code, envelope: JSON.parse(lastLine), stderr})
      } catch {
        reject(
          new Error(
            `create printed no envelope (code ${code})\n${stdout}\n${stderr}`
          )
        )
      }
    })
  })
}

describe('the packed cli scaffolds from a ZIP template URL', () => {
  const manifest = JSON.stringify({
    name: 'Remote Created',
    version: '0.0.1',
    manifest_version: 3
  })
  let workDir = ''
  let server: Server | undefined

  beforeEach(async () => {
    workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'extjs-zip-'))
  })

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      if (!server) return resolve()

      server.close(() => resolve())
    })

    server = undefined
    await fsp.rm(workDir, {recursive: true, force: true})
  })

  it('the shipped entry exists before any case spawns it', () => {
    expect(fs.existsSync(PACKED_CLI)).toBe(true)
  })

  it('scaffolds a manifest at the archive root and names it after the project', async () => {
    const served = await serveZip(
      'template.zip',
      makeZip({'manifest.json': manifest})
    )
    server = served.server
    const dest = path.join(workDir, 'my-remote-ext')

    const {code, envelope} = await createFromUrl(dest, served.url)

    expect(envelope.error).toBeNull()
    expect(code).toBe(0)
    expect(envelope.value?.template).toBe('template.zip')

    const written = JSON.parse(
      await fsp.readFile(path.join(dest, 'manifest.json'), 'utf8')
    )
    expect(written.name).toBe('my-remote-ext')
    expect(written.manifest_version).toBe(3)
  }, 180_000)

  it('keeps a nested manifest where the archive put it', async () => {
    const served = await serveZip(
      'template.zip',
      makeZip({'extension/manifest.json': manifest})
    )
    server = served.server
    const dest = path.join(workDir, 'my-remote-nested-ext')

    const {code, envelope} = await createFromUrl(dest, served.url)

    expect(envelope.error).toBeNull()
    expect(code).toBe(0)

    const nested = path.join(dest, 'extension', 'manifest.json')
    expect(fs.existsSync(nested)).toBe(true)
    expect(fs.existsSync(path.join(dest, 'manifest.json'))).toBe(false)
    expect(JSON.parse(await fsp.readFile(nested, 'utf8')).name).toBe(
      'my-remote-nested-ext'
    )
  }, 180_000)

  it('unwraps a root folder named after the archive, as release zips are', async () => {
    const served = await serveZip(
      'content-react.edge.zip',
      makeZip({'content-react.edge/manifest.json': manifest})
    )
    server = served.server
    const dest = path.join(workDir, 'my-remote-browser-suffix-ext')

    const {code, envelope} = await createFromUrl(dest, served.url)

    expect(envelope.error).toBeNull()
    expect(code).toBe(0)
    expect(fs.existsSync(path.join(dest, 'manifest.json'))).toBe(true)
    expect(
      fs.existsSync(path.join(dest, 'content-react.edge', 'manifest.json'))
    ).toBe(false)
  }, 180_000)

  it('refuses plain http unless the opt-in is set, and scaffolds nothing', async () => {
    const served = await serveZip(
      'template.zip',
      makeZip({'manifest.json': manifest})
    )
    server = served.server
    const dest = path.join(workDir, 'my-refused-ext')

    const {code, envelope} = await createFromUrl(dest, served.url, {
      EXTENSION_ALLOW_HTTP_TEMPLATE: ''
    })

    expect(code).not.toBe(0)
    expect(envelope.ok).toBe(false)
    expect(envelope.error?.message).toContain('plain HTTP')
    expect(fs.existsSync(dest)).toBe(false)
  }, 180_000)
})
