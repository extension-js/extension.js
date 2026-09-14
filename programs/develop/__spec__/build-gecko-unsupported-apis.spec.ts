import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

// One source manifest serves MV3 on Chromium and MV2 on Firefox. A background
// that reads chrome.sidePanel and chrome.action ships fine on Chromium, and
// addons-linter flags both on the Firefox build, so the production build for
// Firefox names them first, once per file per API. A build-time browser
// branch compiles the calls out, and then the build stays quiet.
const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function stripAnsi(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/\[[0-9;]*m/g, '')
}

const UNGUARDED = [
  'chrome.sidePanel.setPanelBehavior({openPanelOnActionClick: true})',
  'chrome.action.onClicked.addListener(() => {',
  '  chrome.sidePanel.open({windowId: 1})',
  '})',
  ''
].join('\n')

const GUARDED = [
  'const isFirefoxLike =',
  "  import.meta.env.EXTENSION_PUBLIC_BROWSER === 'firefox' ||",
  "  import.meta.env.EXTENSION_PUBLIC_BROWSER === 'gecko-based'",
  'if (isFirefoxLike) {',
  '  browser.browserAction.onClicked.addListener(() => {',
  '    browser.sidebarAction.open()',
  '  })',
  '} else {',
  '  chrome.sidePanel.setPanelBehavior({openPanelOnActionClick: true})',
  '  chrome.action.onClicked.addListener(() => {',
  '    chrome.sidePanel.open({windowId: 1})',
  '  })',
  '}',
  ''
].join('\n')

function project(background: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-gecko-apis-'))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'panel', version: '0.0.0'})
  )
  fs.writeFileSync(path.join(root, 'background.js'), background)
  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      name: 'panel',
      version: '1.0.0',
      'chromium:manifest_version': 3,
      'firefox:manifest_version': 2,
      browser_specific_settings: {gecko: {id: 'panel@example.com'}},
      background: {service_worker: 'background.js'}
    })
  )
  return root
}

async function build(root: string, browser: 'chrome' | 'firefox') {
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
    // The linter would repeat the same two findings, this spec is about
    // the build naming them on its own.
    summary = await extensionBuild(root, {
      browser,
      silent: false,
      install: false,
      mode: 'production',
      addonLint: false,
      exitOnError: false
    } as any)
  } finally {
    console.log = originalLog
    console.warn = originalWarn
    console.error = originalError
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }
  expect(summary.errors_count).toBe(0)
  return {summary, output: stripAnsi(lines.join('\n'))}
}

const count = (haystack: string, needle: string) =>
  haystack.split(needle).length - 1

describe('Chromium-only API use on a Firefox build', () => {
  it('firefox MV2: names sidePanel and action once each, from the source file', async () => {
    const {summary, output} = await build(project(UNGUARDED), 'firefox')

    expect(count(output, 'background.js uses chrome.sidePanel')).toBe(1)
    expect(count(output, 'background.js uses chrome.action')).toBe(1)
    expect(output).toContain('sidebar_action')
    expect(output).toContain('browserAction')

    const warnings = summary.warnings || []
    expect(
      warnings.filter((w) => w.includes('uses chrome.sidePanel'))
    ).toHaveLength(1)
    expect(
      warnings.filter((w) => w.includes('uses chrome.action'))
    ).toHaveLength(1)
  }, 180_000)

  it('chromium MV3: stays quiet, both APIs are native there', async () => {
    const {summary, output} = await build(project(UNGUARDED), 'chrome')

    expect(output).not.toContain('uses chrome.sidePanel')
    expect(output).not.toContain('uses chrome.action')
    expect(
      (summary.warnings || []).filter((w) => w.includes('uses chrome.'))
    ).toEqual([])
  }, 180_000)

  it('firefox MV2: stays quiet when a build-time branch compiles the calls out', async () => {
    const root = project(GUARDED)
    const {summary, output} = await build(root, 'firefox')

    expect(output).not.toContain('uses chrome.sidePanel')
    expect(output).not.toContain('uses chrome.action')
    expect(
      (summary.warnings || []).filter((w) => w.includes('uses chrome.'))
    ).toEqual([])

    // The bundle really dropped them, which is what the silence rests on.
    const distDir = path.join(root, 'dist', 'firefox')
    const manifest = JSON.parse(
      fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8')
    )
    const script = fs.readFileSync(
      path.join(distDir, manifest.background.scripts[0]),
      'utf8'
    )
    expect(script).not.toContain('sidePanel')
    expect(script).toContain('browserAction')
  }, 180_000)
})
