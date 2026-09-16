import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

// A production Firefox build runs addons-linter over the emitted dist and
// prints what addons.mozilla.org would flag, as warnings, never as errors.
// addons-linter is a devDependency of this package so the run is real.
const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function stripAnsi(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/\[[0-9;]*m/g, '')
}

// MV2 with no gecko id, plus an eval in the background script: two findings
// the linter reports on its own, neither of which our manifest step covers.
function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-addon-lint-build-'))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'lintme', version: '0.0.0'})
  )

  fs.writeFileSync(
    path.join(root, 'background.js'),
    'const code = "1 + 1"\nconsole.log(eval(code))\n'
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      name: 'lintme',
      version: '1.0.0',
      manifest_version: 2,
      background: {scripts: ['background.js']}
    })
  )

  return root
}

// A code-splitting content script under an MV2 manifest that still writes
// host_permissions: both findings the build step now avoids on its own.
function codeSplitProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-addon-lint-split-'))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'splitme', version: '0.0.0'})
  )

  fs.writeFileSync(
    path.join(root, 'greet.js'),
    'export const greet = () => "SPLIT_GREETING"\n'
  )

  fs.writeFileSync(
    path.join(root, 'content.js'),
    'export default async function main() {\n  const {greet} = await import("./greet.js")\n  console.log(greet())\n}\n'
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      name: 'splitme',
      version: '1.0.0',
      'chromium:manifest_version': 3,
      'firefox:manifest_version': 2,
      browser_specific_settings: {gecko: {id: 'splitme@example.com'}},
      permissions: ['storage'],
      host_permissions: ['<all_urls>'],
      content_scripts: [{matches: ['<all_urls>'], js: ['content.js']}]
    })
  )

  return root
}

async function build(
  root: string,
  options: {
    browser: 'chrome' | 'firefox'
    mode: 'development' | 'production'
    addonLint?: boolean
  }
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
  let summary: {
    errors_count: number
    warnings_count: number
    warnings?: string[]
  }

  try {
    summary = await extensionBuild(root, {
      browser: options.browser,
      silent: false,
      install: false,
      mode: options.mode,
      addonLint: options.addonLint,
      exitOnError: false
    } as any)
  } finally {
    console.log = originalLog
    console.warn = originalWarn
    console.error = originalError
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }

  return {summary, output: stripAnsi(lines.join('\n'))}
}

describe('addon lint after a production firefox build', () => {
  it('prints the linter findings as warnings and keeps the build green', async () => {
    const root = project()
    const {summary, output} = await build(root, {
      browser: 'firefox',
      mode: 'production'
    })

    expect(summary.errors_count).toBe(0)
    expect(output).toContain('built for production')

    expect(output).toMatch(/addons-linter found .* in .*dist[\\/]firefox/)
    expect(output).toContain('AMO warning MISSING_ADDON_ID')
    expect(output).toContain('AMO warning DANGEROUS_EVAL: eval can be harmful.')
    // The bundler emits the script under background/, the location follows.
    expect(output).toMatch(/\(background[\\/]scripts\.js:\d+\)/)
    // Our own manifest warning already covers this code, so it prints once.
    expect(output).not.toContain('MISSING_DATA_COLLECTION_PERMISSIONS')

    // The structured channel carries the same lines for json consumers.
    expect(summary.warnings_count).toBeGreaterThanOrEqual(2)
    expect(
      (summary.warnings || []).some((line) => line.includes('DANGEROUS_EVAL'))
    ).toBe(true)
  }, 180_000)

  it('does not flag the MV2 manifest or the chunk loader the build emits', async () => {
    const root = codeSplitProject()
    const {summary, output} = await build(root, {
      browser: 'firefox',
      mode: 'production'
    })

    expect(summary.errors_count).toBe(0)
    expect(output).not.toContain('MANIFEST_FIELD_UNSUPPORTED')
    expect(output).not.toContain('UNSAFE_VAR_ASSIGNMENT')

    const distDir = path.join(root, 'dist', 'firefox')
    const manifest = JSON.parse(
      fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8')
    )
    expect(manifest.manifest_version).toBe(2)
    expect(manifest).not.toHaveProperty('host_permissions')
    expect(manifest.permissions).toEqual(['storage', '<all_urls>'])

    // The content script keeps its native chunk loader, and every dynamic
    // import in it goes through chrome.runtime.getURL, the form AMO accepts.
    const entry: string = manifest.content_scripts[0].js[0]
    const script = fs.readFileSync(path.join(distDir, entry), 'utf8')
    const imports = script.match(/\bimport\(/g) || []
    expect(imports.length).toBeGreaterThan(0)
    expect(
      script.match(/\bimport\(chrome\.runtime\.getURL\(/g) || []
    ).toHaveLength(imports.length)
  }, 180_000)

  it('stays quiet when addonLint is off, in development mode, and for chromium', async () => {
    const root = project()

    const off = await build(root, {
      browser: 'firefox',
      mode: 'production',
      addonLint: false
    })
    expect(off.summary.errors_count).toBe(0)
    expect(off.output).not.toContain('addons-linter')
    expect(off.output).not.toContain('AMO warning')

    const dev = await build(root, {browser: 'firefox', mode: 'development'})
    expect(dev.summary.errors_count).toBe(0)
    expect(dev.output).not.toContain('AMO warning')

    const chrome = await build(root, {browser: 'chrome', mode: 'production'})
    expect(chrome.summary.errors_count).toBe(0)
    expect(chrome.output).not.toContain('AMO warning')
  }, 180_000)
})
