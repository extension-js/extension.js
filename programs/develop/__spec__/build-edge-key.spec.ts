import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

// Edge Add-ons refuses a package whose manifest carries `key`, so a
// production Edge build drops the field and says so once. A development
// build keeps it, where the stable id is useful, and Chrome keeps it always.
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
  mode: 'production' | 'development'
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

const NOTICE = /Edge Add-ons refuses a package whose manifest carries/

describe('the manifest key on an Edge build', () => {
  it('edge production: drops the top-level key and prints the notice once', async () => {
    const built = await build(project(), 'edge', 'production')

    expect(built.manifest).not.toHaveProperty('key')
    expect(built.manifest.name).toBe('edge key')
    expect(built.output).toMatch(NOTICE)
    expect(built.output).toMatch(/production build dropped it/)
    expect(built.printed.match(/production build dropped it/g)).toHaveLength(1)
  }, 180_000)

  it('edge development: keeps the key and stays quiet', async () => {
    const built = await build(project(), 'edge', 'development')

    expect(built.manifest.key).toBe(KEY)
    expect(built.output).not.toMatch(NOTICE)
  }, 180_000)

  it('chrome production: keeps the key and stays quiet', async () => {
    const built = await build(project(), 'chrome', 'production')

    expect(built.manifest.key).toBe(KEY)
    expect(built.output).not.toMatch(NOTICE)
  }, 180_000)
})
