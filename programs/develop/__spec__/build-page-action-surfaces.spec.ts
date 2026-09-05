import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

// Firefox drives the toolbar and the address bar independently, so a
// browser_action/action popup and a page_action popup are two pages unless
// they name one source. Chromium dropped page_action with MV3.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQAB' +
    'h6FO1AAAAABJRU5ErkJggg==',
  'base64'
)
const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project(manifest: Record<string, unknown>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-page-action-'))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'surfaces', version: '0.0.0'})
  )
  fs.mkdirSync(path.join(root, 'pages'))
  fs.mkdirSync(path.join(root, 'images'))
  fs.writeFileSync(path.join(root, 'images', 'address.png'), PNG)
  fs.writeFileSync(
    path.join(root, 'pages', 'toolbar.html'),
    '<!doctype html><title>TOOLBAR</title><p>toolbar</p>'
  )
  fs.writeFileSync(
    path.join(root, 'pages', 'address.html'),
    '<!doctype html><title>ADDRESS</title><script src="./address.js"></script><img src="../images/address.png">'
  )
  fs.writeFileSync(
    path.join(root, 'pages', 'address.js'),
    'console.log("address")\n'
  )
  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({name: 'Surfaces', version: '1.0.0', ...manifest})
  )
  return root
}

async function build(root: string, browser: 'firefox' | 'chrome') {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'
  const warnings: string[] = []
  const originalWarn = console.warn
  const originalLog = console.log
  console.warn = (...args: unknown[]) => warnings.push(args.join(' '))
  console.log = (...args: unknown[]) => warnings.push(args.join(' '))
  let summary: {errors_count: number}
  try {
    summary = await extensionBuild(root, {
      browser,
      silent: false,
      install: false,
      mode: 'production',
      exitOnError: false
    } as any)
  } finally {
    console.warn = originalWarn
    console.log = originalLog
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }
  expect(summary.errors_count).toBe(0)
  const distDir = path.join(root, 'dist', browser)
  const manifest = JSON.parse(
    fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8')
  )
  const page = (rel: string) => fs.readFileSync(path.join(distDir, rel), 'utf8')
  return {distDir, manifest, page, output: warnings.join('\n')}
}

describe('Firefox popups', () => {
  it('ships the toolbar and the address bar popups as two pages (MV2)', async () => {
    const {distDir, manifest, page} = await build(
      project({
        manifest_version: 2,
        browser_action: {default_popup: 'pages/toolbar.html'},
        page_action: {default_popup: 'pages/address.html'}
      }),
      'firefox'
    )
    expect(manifest.browser_action.default_popup).toBe('action/index.html')
    expect(manifest.page_action.default_popup).toBe('page_action/index.html')
    expect(page('action/index.html')).toContain('TOOLBAR')
    expect(page('action/index.html')).not.toContain('ADDRESS')
    const address = page('page_action/index.html')
    expect(address).toContain('ADDRESS')
    // The address page compiles like any other page: script entry + asset.
    for (const ref of address.matchAll(/(?:src|href)="([^"]+)"/g)) {
      const target = ref[1].replace(/^\//, '')
      expect(
        fs.existsSync(path.join(distDir, target)),
        `${ref[1]} missing`
      ).toBe(true)
    }
    expect(fs.existsSync(path.join(distDir, 'page_action', 'index.js'))).toBe(
      true
    )
  }, 120_000)

  it('splits the MV3 action key from page_action the same way', async () => {
    const {manifest, page} = await build(
      project({
        manifest_version: 3,
        action: {default_popup: 'pages/toolbar.html'},
        page_action: {default_popup: 'pages/address.html'}
      }),
      'firefox'
    )
    expect(manifest.action.default_popup).toBe('action/index.html')
    expect(manifest.page_action.default_popup).toBe('page_action/index.html')
    expect(page('page_action/index.html')).toContain('ADDRESS')
  }, 120_000)

  it('keeps sharing one page when both keys name one source', async () => {
    const {distDir, manifest} = await build(
      project({
        manifest_version: 2,
        browser_action: {default_popup: 'pages/toolbar.html'},
        page_action: {default_popup: './pages/toolbar.html'}
      }),
      'firefox'
    )
    expect(manifest.browser_action.default_popup).toBe('action/index.html')
    expect(manifest.page_action.default_popup).toBe('action/index.html')
    expect(fs.existsSync(path.join(distDir, 'page_action'))).toBe(false)
  }, 120_000)

  it('leaves a single toolbar popup exactly as before', async () => {
    const {distDir, manifest} = await build(
      project({
        manifest_version: 2,
        browser_action: {default_popup: 'pages/toolbar.html'}
      }),
      'firefox'
    )
    expect(manifest.browser_action.default_popup).toBe('action/index.html')
    expect(manifest.page_action).toBeUndefined()
    expect(fs.existsSync(path.join(distDir, 'page_action'))).toBe(false)
  }, 120_000)
})

describe('Chromium popups', () => {
  it('drops page_action from an MV3 build and says so', async () => {
    const {distDir, manifest, output} = await build(
      project({
        manifest_version: 3,
        action: {default_popup: 'pages/toolbar.html'},
        page_action: {default_popup: 'pages/address.html'}
      }),
      'chrome'
    )
    expect(manifest.action.default_popup).toBe('action/index.html')
    expect(manifest.page_action).toBeUndefined()
    expect(fs.existsSync(path.join(distDir, 'page_action'))).toBe(false)
    expect(output).toContain(
      'does not show the page_action address bar surface'
    )
  }, 120_000)

  // Chrome refuses an MV2 manifest that declares both browser_action and
  // page_action, so the build keeps the toolbar key and says what it dropped.
  it('keeps browser_action over page_action in an MV2 build and names the dropped key', async () => {
    const {distDir, manifest, output} = await build(
      project({
        manifest_version: 2,
        browser_action: {default_popup: 'pages/toolbar.html'},
        page_action: {default_popup: 'pages/address.html'}
      }),
      'chrome'
    )
    expect(manifest.browser_action.default_popup).toBe('action/index.html')
    expect(manifest.page_action).toBeUndefined()
    expect(fs.existsSync(path.join(distDir, 'page_action'))).toBe(false)
    expect(output).toContain('page_action')
    expect(output).toContain('browser_action')
    expect(output).toMatch(/dropped/i)
  }, 120_000)

  it('keeps a lone page_action in an MV2 build', async () => {
    const {distDir, manifest} = await build(
      project({
        manifest_version: 2,
        page_action: {default_popup: 'pages/address.html'}
      }),
      'chrome'
    )
    expect(manifest.page_action.default_popup).toBe('page_action/index.html')
    expect(fs.existsSync(path.join(distDir, 'page_action', 'index.html'))).toBe(
      true
    )
  }, 120_000)
})
