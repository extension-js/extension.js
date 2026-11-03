import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {unzipSync} from 'fflate'
import {afterAll, describe, expect, it} from 'vitest'

// Edge Add-ons refuses a package whose manifest carries `key`, so the store
// zip leaves it out and says so once. dist/edge keeps it: an unpacked install
// gets the id the key pins, which an OAuth redirect allow-list depends on.
const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

const KEY = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA'

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-edge-key-'))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'edge-key', version: '0.0.0'})
  )

  fs.writeFileSync(path.join(root, 'content.js'), 'console.log("key")\n')
  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'edge key',
      version: '1.0.0',
      key: KEY,
      content_scripts: [
        {matches: ['https://example.com/*'], js: ['content.js']}
      ]
    })
  )

  return root
}

async function build(
  root: string,
  browser: 'chrome' | 'edge',
  mode: 'production' | 'development',
  zip = false
) {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'
  const lines: string[] = []
  const originalLog = console.log
  const originalWarn = console.warn
  const originalError = console.error
  console.log = (...args: unknown[]) => lines.push(args.join(' '))
  console.warn = (...args: unknown[]) => lines.push(args.join(' '))
  console.error = (...args: unknown[]) => lines.push(args.join(' '))
  let summary: {errors_count: number; warnings?: string[]}

  try {
    summary = await extensionBuild(root, {
      browser,
      silent: false,
      install: false,
      mode,
      zip,
      exitOnError: false
    } as any)

    expect(summary.errors_count).toBe(0)
  } finally {
    console.log = originalLog
    console.warn = originalWarn
    console.error = originalError
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }

  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, 'dist', browser, 'manifest.json'), 'utf8')
  )
  // Warnings travel on the summary's structured channel as well as stdout,
  // so the count of what the user saw comes from the printed lines alone.
  const printed = lines.join('\n')
  const output = [printed, ...(summary.warnings || [])].join('\n')

  return {manifest, output, printed}
}

function zippedManifest(root: string, browser: 'chrome' | 'edge') {
  const zipPath = path.join(root, 'dist', `edge-key-1.0.0-${browser}.zip`)
  const unzipped = unzipSync(new Uint8Array(fs.readFileSync(zipPath)))

  return {
    zipPath,
    manifest: JSON.parse(Buffer.from(unzipped['manifest.json']).toString())
  }
}

const NOTICE = /Edge Add-ons refuses a package whose manifest carries/

describe('the manifest key on an Edge build', () => {
  it('edge production: keeps the key in dist and stays quiet', async () => {
    const built = await build(project(), 'edge', 'production')

    expect(built.manifest.key).toBe(KEY)
    expect(built.output).not.toMatch(NOTICE)
  })

  it('edge --zip: dist keeps the key, the zip leaves it out, one notice', async () => {
    const root = project()
    const built = await build(root, 'edge', 'production', true)
    const zipped = zippedManifest(root, 'edge')

    expect(built.manifest.key).toBe(KEY)
    expect(zipped.manifest).not.toHaveProperty('key')
    expect(zipped.manifest.name).toBe('edge key')
    expect(built.output).toMatch(NOTICE)
    expect(built.output).toContain(zipped.zipPath)
    expect(built.output).toMatch(/dist\/edge.*keeps it/)
    expect(built.printed.match(NOTICE)).toHaveLength(1)
  })

  it('edge development: keeps the key and stays quiet', async () => {
    const built = await build(project(), 'edge', 'development')

    expect(built.manifest.key).toBe(KEY)
    expect(built.output).not.toMatch(NOTICE)
  })

  it('chrome --zip: the zip keeps the key and stays quiet', async () => {
    const root = project()
    const built = await build(root, 'chrome', 'production', true)
    const zipped = zippedManifest(root, 'chrome')

    expect(built.manifest.key).toBe(KEY)
    expect(zipped.manifest.key).toBe(KEY)
    expect(built.output).not.toMatch(NOTICE)
  })
})
