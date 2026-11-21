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
  options: {
    browser: 'chrome' | 'firefox'
    polyfill?: boolean
    metadataCommand?: 'start'
  }
) {
  const {extensionBuild} = await import('../command-build')

  return await extensionBuild(root, {
    ...options,
    silent: true,
    install: false,
    mode: 'production'
  } as Parameters<typeof import('../command-build').extensionBuild>[1])
}

function polyfillWarnings(summary: {warnings?: string[]}) {
  return (summary.warnings || []).filter((text) => text.includes('--polyfill'))
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
    expect(warnings[0]).toContain('background.js:1 uses browser.*')
    expect(warnings[0]).toContain(
      'The cross-browser polyfill is off, the default for every command'
    )

    expect(warnings[0]).toContain('run extension build with --polyfill')
    expect(warnings[0]).toContain('set commands.build.polyfill to true')
    expect(warnings[0]).not.toContain('extension dev and extension start')
    expect(serviceWorker(root, 'chrome')).toContain('browser.storage.local')
    expect(serviceWorker(root, 'chrome')).not.toContain('webextension-polyfill')
  }, 120_000)

  it('leaves the polyfill out of extension start too, and names its own key', async () => {
    const root = project()
    const summary = await build(root, {
      browser: 'chrome',
      metadataCommand: 'start'
    })

    expect(summary.errors_count).toBe(0)
    const warnings = polyfillWarnings(summary)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('run extension start with --polyfill')
    expect(warnings[0]).toContain('set commands.start.polyfill to true')
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
