import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

// The dev build keeps the author's security contract apart from what the
// dev server needs: the sandbox policy survives, optional lists stay as
// written, and every promotion dev makes is named in a warning.
const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

const SANDBOX =
  "sandbox allow-scripts; script-src 'self' https://cdn.example.com"

function project(manifest: Record<string, unknown>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-dev-fidelity-'))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'fidelity', version: '0.0.0'})
  )
  fs.writeFileSync(path.join(root, 'content.js'), 'console.log("cs")\n')
  fs.writeFileSync(
    path.join(root, 'background.js'),
    'chrome.storage.local.get("k")\n'
  )
  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({name: 'fidelity', version: '1.0.0', ...manifest})
  )
  return root
}

async function build(
  root: string,
  browser: 'chrome' | 'firefox',
  mode: 'development' | 'production'
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
  // Warnings travel on the summary's structured channel as well as stdout.
  const output = [...lines, ...(summary.warnings || [])].join('\n')
  return {manifest, output}
}

describe('dev manifest keeps the author security contract', () => {
  it('chrome MV3: sandbox survives, optional lists stay, promotions are named', async () => {
    const root = project({
      manifest_version: 3,
      background: {service_worker: 'background.js'},
      content_scripts: [
        {matches: ['https://opt.example.com/*'], js: ['content.js']}
      ],
      content_security_policy: {
        extension_pages: "script-src 'self'; object-src 'self'",
        sandbox: SANDBOX
      },
      permissions: ['alarms'],
      optional_permissions: ['tabs', 'storage'],
      optional_host_permissions: ['https://opt.example.com/*']
    })
    const prod = await build(root, 'chrome', 'production')
    const dev = await build(root, 'chrome', 'development')

    expect(prod.manifest.content_security_policy.sandbox).toBe(SANDBOX)
    expect(dev.manifest.content_security_policy.sandbox).toBe(SANDBOX)
    expect(dev.manifest.content_security_policy.extension_pages).toContain(
      "script-src 'self'"
    )
    expect(dev.manifest.optional_permissions).toEqual(
      prod.manifest.optional_permissions
    )
    expect(dev.manifest.optional_host_permissions).toEqual(
      prod.manifest.optional_host_permissions
    )
    expect(prod.manifest.permissions).toEqual(['alarms'])
    expect(dev.output).toMatch(/optional_permissions[\s\S]*"tabs"/)
    expect(dev.output).toContain('https://opt.example.com/*')
    // Source uses storage that the author only made optional.
    expect(dev.output).toMatch(
      /only lists the "storage" permission under optional_permissions/
    )
  }, 180_000)

  it('firefox MV2: the same contract holds', async () => {
    const root = project({
      manifest_version: 2,
      background: {scripts: ['background.js']},
      content_scripts: [
        {matches: ['https://opt.example.com/*'], js: ['content.js']}
      ],
      content_security_policy: {
        extension_pages: "script-src 'self'; object-src 'self'",
        sandbox: SANDBOX
      },
      optional_permissions: ['tabs', 'storage', 'https://opt.example.com/*'],
      browser_specific_settings: {gecko: {id: 'fidelity@example.com'}}
    })
    const prod = await build(root, 'firefox', 'production')
    const dev = await build(root, 'firefox', 'development')

    expect(prod.manifest.content_security_policy.sandbox).toBe(SANDBOX)
    expect(dev.manifest.content_security_policy.sandbox).toBe(SANDBOX)
    expect(dev.manifest.optional_permissions).toEqual(
      prod.manifest.optional_permissions
    )
    expect(dev.output).toMatch(/optional_permissions[\s\S]*"tabs"/)
    expect(dev.output).toContain('https://opt.example.com/*')
  }, 180_000)
})
