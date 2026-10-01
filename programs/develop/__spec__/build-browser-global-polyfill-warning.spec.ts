import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-browser-global-'))
  roots.push(root)

  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'browser-global', version: '0.0.0'})
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'browser-global',
      version: '1.0.0',
      permissions: ['storage'],
      background: {service_worker: 'background.js'}
    })
  )

  fs.writeFileSync(
    path.join(root, 'background.js'),
    'browser.storage.local.get("k").then((v) => console.log(v))\n'
  )

  return root
}

async function build(
  root: string,
  options: {browser: 'chrome' | 'firefox'; polyfill?: boolean}
) {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'

  try {
    return await extensionBuild(root, {
      ...options,
      silent: true,
      install: false,
      mode: 'production',
      exitOnError: false
    } as any)
  } finally {
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }
}

function polyfillWarnings(summary: {warnings?: string[]}) {
  return (summary.warnings || []).filter((text) =>
    text.includes('--polyfill')
  )
}

function serviceWorker(root: string, browser: string) {
  return fs.readFileSync(
    path.join(root, 'dist', browser, 'background', 'service_worker.js'),
    'utf-8'
  )
}

describe('a build of browser.* code on a Chromium target', () => {
  it('warns by flag name when the polyfill is off by default', async () => {
    const root = project()
    const summary = await build(root, {browser: 'chrome'})

    expect(summary.errors_count).toBe(0)
    const warnings = polyfillWarnings(summary)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('background.js uses browser.*')
    expect(warnings[0]).toContain('extension dev and extension start')
    expect(warnings[0]).toContain('extension build leaves it off')
    expect(serviceWorker(root, 'chrome')).toContain('browser.storage.local')
    expect(serviceWorker(root, 'chrome')).not.toContain('webextension-polyfill')
  }, 120_000)

  it('stays quiet with the polyfill on', async () => {
    const root = project()
    const summary = await build(root, {browser: 'chrome', polyfill: true})

    expect(summary.errors_count).toBe(0)
    expect(polyfillWarnings(summary)).toEqual([])
    expect(serviceWorker(root, 'chrome')).toContain('webextension-polyfill')
  }, 120_000)

  it('stays quiet on firefox, which ships browser.* itself', async () => {
    const root = project()
    const summary = await build(root, {browser: 'firefox'})

    expect(summary.errors_count).toBe(0)
    expect(polyfillWarnings(summary)).toEqual([])
  }, 120_000)
})
