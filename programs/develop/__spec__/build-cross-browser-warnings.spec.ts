import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {buildProject} from './helpers/build-project'
import {trackTempFolders} from './helpers/temp-folders'
import {writeProjectFiles} from './helpers/extension-project'

// One Chromium-first side panel project, built for each engine. The panel
// page is written at the root and ships as sidebar/index.html, its script
// injects three files that reach the output three ways, and the background
// calls chrome.sidePanel behind its own presence check.
const tempFolder = trackTempFolders()

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')

const BACKGROUND = [
  "const label: string = 'worker'",
  'console.log(label)',
  'if (chrome.sidePanel) {',
  '  chrome.sidePanel',
  '    .setPanelBehavior({openPanelOnActionClick: true})',
  '    .catch((error: unknown) => console.error(error))',
  '} else {',
  '  chrome.action.onClicked.addListener(() => {',
  '    ;(globalThis as any).browser?.sidebarAction?.toggle()',
  '  })',
  '}',
  ''
].join('\n')

const PANEL = [
  'const h = (tag, props) => Object.assign(document.createElement(tag), props)',
  "document.body.append(h('img', {src: 'logo.png', alt: 'logo'}))",
  'export async function inject(tabId) {',
  "  await chrome.scripting.executeScript({target: {tabId}, files: ['scripts/copied.js']})",
  "  await chrome.scripting.executeScript({target: {tabId}, files: ['scripts/pub.js']})",
  "  await chrome.scripting.executeScript({target: {tabId}, files: ['scripts/built.js']})",
  '}',
  "document.addEventListener('click', () => inject(1))",
  ''
].join('\n')

function project(manifest: Record<string, unknown> = {}) {
  const root = tempFolder('extjs-xbrowser-')

  const files: Record<string, string> = {
    'package.json': JSON.stringify({
      private: true,
      type: 'module',
      name: 'xbrowser',
      version: '0.0.0'
    }),
    'manifest.json': JSON.stringify({
      manifest_version: 3,
      name: 'xbrowser',
      version: '1.0.0',
      browser_specific_settings: {gecko: {id: 'xbrowser@example.com'}},
      permissions: ['sidePanel', 'debugger', 'scripting', 'storage'],
      host_permissions: ['<all_urls>'],
      incognito: 'split',
      action: {default_title: 'x'},
      background: {service_worker: 'background.ts'},
      side_panel: {default_path: 'index.html'},
      ...manifest
    }),
    'extension.config.js':
      "export default {include: {'scripts/copied.js': './vendor/copied.js'}}\n",
    'background.ts': BACKGROUND,
    'index.html':
      '<!doctype html><html><head><meta charset="utf-8"></head><body>' +
      '<script src="./panel.js"></script></body></html>\n',
    'panel.js': PANEL,
    'public/logo.png': 'png',
    'public/scripts/pub.js': 'console.log("pub")\n',
    'vendor/copied.js': 'console.log("copied")\n',
    'scripts/built.js': 'console.log("built")\n'
  }

  writeProjectFiles(root, files)

  return root
}

async function build(root: string, browser: 'chrome' | 'firefox' | 'safari') {
  const lines: string[] = []
  const original = {
    log: console.log,
    warn: console.warn,
    error: console.error
  }
  console.log = (...args: unknown[]) => lines.push(args.join(' '))
  console.warn = (...args: unknown[]) => lines.push(args.join(' '))
  console.error = (...args: unknown[]) => lines.push(args.join(' '))
  let summary: {errors_count: number; warnings?: string[]}

  try {
    summary = await buildProject(root, {
      browser,
      silent: false,
      mode: 'production',
      addonLint: false
    })
  } finally {
    Object.assign(console, original)
  }

  expect(summary.errors_count).toBe(0)

  const distDir = path.join(root, 'dist', browser)
  const warnings = (summary.warnings || []).map((text) =>
    text.replace(ANSI, '')
  )

  return {
    manifest: JSON.parse(
      fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8')
    ),
    has: (file: string) => fs.existsSync(path.join(distDir, file)),
    warnings,
    output: lines.join('\n').replace(ANSI, '')
  }
}

const PAGE_RELATIVE = 'Firefox resolves that path against the page'

describe('a Chromium-first side panel project built for each engine', () => {
  it('firefox: warns for every page-relative injected file the output holds at the root', async () => {
    const built = await build(project(), 'firefox')

    expect(built.has('sidebar/index.html')).toBe(true)

    for (const file of [
      'scripts/copied.js',
      'scripts/pub.js',
      'scripts/built.js'
    ]) {
      expect(built.has(file), file).toBe(true)
      expect(
        built.warnings.filter(
          (text) =>
            text.includes(PAGE_RELATIVE) && text.includes(`names '${file}'`)
        ),
        file
      ).toHaveLength(1)
    }

    expect(
      built.warnings.find((text) => text.includes("names 'scripts/copied.js'"))
    ).toContain('Start the path at the extension root: /scripts/copied.js.')
  }, 180_000)

  it('firefox and safari: stay quiet about a chrome.sidePanel call behind its own check', async () => {
    for (const browser of ['firefox', 'safari'] as const) {
      const built = await build(project(), browser)

      expect(built.output, browser).not.toContain('chrome.sidePanel, which')
      expect(
        built.warnings.filter((text) => text.includes('chrome.sidePanel')),
        browser
      ).toEqual([])
    }
  }, 240_000)

  it('firefox and chrome: name the relative src of a page shipped in another folder', async () => {
    for (const browser of ['firefox', 'chrome'] as const) {
      const built = await build(project(), browser)
      const page = 'sidebar'
      const found = built.warnings.filter((text) =>
        text.includes("sets a src or href to 'logo.png'")
      )

      expect(built.has('logo.png'), browser).toBe(true)
      expect(built.has(`${page}/logo.png`), browser).toBe(false)
      expect(found, browser).toHaveLength(1)
      expect(found[0]).toContain('panel.js sets a src or href')
      expect(found[0]).toContain(`PAGE ${page}/index.html`)

      expect(found[0]).toContain(`REQUESTED ${page}/logo.png`)
      expect(found[0]).toContain('EMITTED logo.png')
      expect(found[0]).toContain(
        'Start the path at the extension root: /logo.png.'
      )

      expect(built.output).toContain(
        'Runtime-risk: panel.js sets a src or href'
      )
    }
  }, 240_000)

  it('chrome: keeps every permission and says nothing about Firefox', async () => {
    const built = await build(project(), 'chrome')

    expect(built.manifest.permissions).toEqual([
      'sidePanel',
      'debugger',
      'scripting',
      'storage'
    ])

    expect(built.manifest.incognito).toBe('split')
    expect(built.output).not.toContain('Firefox has no')
    expect(
      built.warnings.filter((text) => text.includes(PAGE_RELATIVE))
    ).toEqual([])
  }, 180_000)
})

describe('the manifest keys a firefox build cannot use', () => {
  it('drops the permissions Firefox rejects, keeps incognito split and names both', async () => {
    const {resetGeckoKeyNotices} = await import(
      '../plugin-web-extension/feature-manifest/manifest-lib/filter-keys-gecko'
    )
    resetGeckoKeyNotices()

    const built = await build(project(), 'firefox')

    expect(built.manifest.permissions).toEqual(['scripting', 'storage'])
    expect(built.manifest.incognito).toBe('split')
    expect(built.output).toContain(
      'Firefox has no support for 2 manifest keys this project declares, so the firefox build dropped them:'
    )

    expect(built.output).toContain(
      'permissions.sidePanel Firefox has no sidePanel permission'
    )

    expect(built.output).toContain(
      'permissions.debugger Firefox has no debugger permission'
    )

    expect(built.output).toContain(
      'Firefox has no split mode, so it reads incognito: "split" as "not_allowed" and the firefox build never runs in private windows.'
    )
  }, 180_000)

  it('takes the firefox: prefix as the choice and then says nothing about incognito', async () => {
    const {resetGeckoKeyNotices} = await import(
      '../plugin-web-extension/feature-manifest/manifest-lib/filter-keys-gecko'
    )
    resetGeckoKeyNotices()

    const built = await build(
      project({'firefox:incognito': 'spanning'}),
      'firefox'
    )

    expect(built.manifest.incognito).toBe('spanning')
    expect(built.output).not.toContain('Firefox has no split mode')
  }, 180_000)
})
