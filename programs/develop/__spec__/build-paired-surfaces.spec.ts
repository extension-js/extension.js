import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project(manifest: Record<string, unknown>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-paired-surfaces-'))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'paired', version: '0.0.0'})
  )

  for (const [folder, title] of [
    ['sidepanel', 'CHROMIUM SIDE PANEL'],
    ['firefoxsidebar', 'GECKO SIDEBAR'],
    ['chromepopup', 'CHROME ACTION POPUP'],
    ['firefoxpopup', 'FIREFOX BROWSER ACTION POPUP']
  ]) {
    fs.mkdirSync(path.join(root, folder))
    fs.writeFileSync(
      path.join(root, folder, 'index.html'),
      `<!doctype html><title>${title}</title><script src="./index.js"></script><h1>${title}</h1>`
    )

    fs.writeFileSync(
      path.join(root, folder, 'index.js'),
      `console.log(${JSON.stringify(title)})\n`
    )
  }

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({name: 'Paired', version: '1.0.0', ...manifest})
  )

  return root
}

async function build(root: string, browser: 'firefox' | 'chrome') {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'
  let summary: {errors_count: number}

  try {
    summary = await extensionBuild(root, {
      browser,
      silent: true,
      install: false,
      mode: 'production',
      exitOnError: false
    } as any)
  } finally {
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }

  expect(summary.errors_count).toBe(0)
  const distDir = path.join(root, 'dist', browser)
  const manifest = JSON.parse(
    fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8')
  )
  const page = (rel: string) => fs.readFileSync(path.join(distDir, rel), 'utf8')
  const has = (rel: string) => fs.existsSync(path.join(distDir, rel))

  return {manifest, page, has}
}

const sidebarPair = {
  manifest_version: 3,
  side_panel: {default_path: 'sidepanel/index.html'},
  sidebar_action: {default_panel: 'firefoxsidebar/index.html'}
}

const toolbarPair = {
  manifest_version: 3,
  action: {default_popup: 'chromepopup/index.html'},
  browser_action: {default_popup: 'firefoxpopup/index.html'}
}

describe.each(['firefox', 'chrome'] as const)('%s build', (browser) => {
  it('emits both sidebar pages and points each key at its own', async () => {
    const {manifest, page, has} = await build(project(sidebarPair), browser)

    expect(manifest.side_panel.default_path).toBe('sidebar/index.html')
    expect(manifest.sidebar_action.default_panel).toBe(
      'sidebar_action/index.html'
    )

    expect(page('sidebar/index.html')).toContain('CHROMIUM SIDE PANEL')
    expect(page('sidebar/index.html')).not.toContain('GECKO SIDEBAR')
    expect(page('sidebar_action/index.html')).toContain('GECKO SIDEBAR')
    expect(has('sidebar_action/index.js')).toBe(true)
  }, 120_000)

  it('emits both toolbar popups and points each key at its own', async () => {
    const {manifest, page, has} = await build(project(toolbarPair), browser)

    expect(manifest.action.default_popup).toBe('action/index.html')
    expect(manifest.browser_action.default_popup).toBe(
      'browser_action/index.html'
    )

    expect(page('action/index.html')).toContain('CHROME ACTION POPUP')
    expect(page('action/index.html')).not.toContain('FIREFOX BROWSER ACTION')
    expect(page('browser_action/index.html')).toContain(
      'FIREFOX BROWSER ACTION POPUP'
    )

    expect(has('browser_action/index.js')).toBe(true)
  }, 120_000)
})

describe('shared sources', () => {
  it('folds both sidebar keys into one page when they name one source', async () => {
    const {manifest, has} = await build(
      project({
        manifest_version: 3,
        side_panel: {default_path: 'sidepanel/index.html'},
        sidebar_action: {default_panel: './sidepanel/index.html'}
      }),
      'firefox'
    )

    expect(manifest.side_panel.default_path).toBe('sidebar/index.html')
    expect(manifest.sidebar_action.default_panel).toBe('sidebar/index.html')
    expect(has('sidebar_action')).toBe(false)
  }, 120_000)

  it('folds both toolbar keys into one page when they name one source', async () => {
    const {manifest, has} = await build(
      project({
        manifest_version: 3,
        action: {default_popup: 'chromepopup/index.html'},
        browser_action: {default_popup: './chromepopup/index.html'}
      }),
      'chrome'
    )

    expect(manifest.action.default_popup).toBe('action/index.html')
    expect(manifest.browser_action.default_popup).toBe('action/index.html')
    expect(has('browser_action')).toBe(false)
  }, 120_000)
})
