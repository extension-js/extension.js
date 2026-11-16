import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project(files: Record<string, string>, background: unknown) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-surface-paths-'))
  roots.push(root)

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'surface-paths',
      version: '1.0.0',
      action: {default_popup: 'popup.html'},
      permissions: ['notifications'],
      background
    })
  )

  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel)
    fs.mkdirSync(path.dirname(abs), {recursive: true})
    fs.writeFileSync(abs, content)
  }

  return root
}

async function build(root: string, browser: 'chrome' | 'firefox') {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'

  try {
    return await extensionBuild(root, {
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
}

function outputFiles(root: string, browser: string): string[] {
  const out = path.join(root, 'dist', browser)
  const walk = (dir: string): string[] =>
    fs
      .readdirSync(dir, {withFileTypes: true})
      .flatMap((entry) =>
        entry.isDirectory()
          ? walk(path.join(dir, entry.name))
          : [path.relative(out, path.join(dir, entry.name))]
      )

  return walk(out)
    .map((file) => file.split(path.sep).join('/'))
    .sort()
}

// Every path form, from a worker and a popup the author wrote at the root.
const CALLS = [
  'const api = globalThis.browser || globalThis.chrome',
  'api.runtime.onMessage.addListener(async () => {',
  '  await api.action.setIcon({path: "on.png"})',
  '  await api.action.setIcon({path: {16: "./icons/dot.png"}})',
  '  await api.action.setIcon({path: "../up.png"})',
  '  await api.action.setIcon({path: "/abs.png"})',
  '  await api.notifications.create({type: "basic", iconUrl: "bell.png", title: "t", message: "m"})',
  '  await api.tabs.create({url: "welcome.html"})',
  '  await api.windows.create({url: "./pages/info.html"})',
  '  await api.action.setPopup({popup: "pop2.html"})',
  '})',
  ''
].join('\n')
const FILES = {
  'background.js': CALLS,
  'popup.html': '<html><body><script src="popup.js"></script></body></html>',
  'popup.js': CALLS,
  'on.png': 'png',
  'icons/dot.png': 'png',
  'up.png': 'png',
  'abs.png': 'png',
  'bell.png': 'png',
  'welcome.html': '<p>welcome</p>',
  'pages/info.html': '<p>info</p>',
  'pop2.html': '<p>pop2</p>'
}
const PAGES = ['pages/info.html', 'pop2.html', 'welcome.html']
const named = (root: string, browser: string) =>
  outputFiles(root, browser).filter(
    (file) => file.endsWith('.png') || PAGES.includes(file)
  )

describe('a path a moved script hands to a runtime surface call', () => {
  it('ships where chrome reads it: icons beside the caller, pages at the root', async () => {
    const root = project(FILES, {service_worker: 'background.js'})

    const summary = await build(root, 'chrome')
    expect(summary.errors_count).toBe(0)
    expect(summary.warnings || []).toEqual([])
    expect(named(root, 'chrome')).toEqual([
      'abs.png',
      'action/bell.png',
      'action/icons/dot.png',
      'action/on.png',
      'background/bell.png',
      'background/icons/dot.png',
      'background/on.png',
      'pages/info.html',
      'pop2.html',
      'up.png',
      'welcome.html'
    ])

    // Chrome opens a page path from the root, so the code stays as written.
    const popup = fs.readFileSync(
      path.join(root, 'dist/chrome/action/index.js'),
      'utf8'
    )
    expect(popup).toContain('"welcome.html"')
    expect(popup).toContain('"on.png"')
  }, 120_000)

  it('ships where firefox reads it: pages rooted for the moved popup', async () => {
    const root = project(FILES, {scripts: ['background.js']})

    const summary = await build(root, 'firefox')
    expect(summary.errors_count).toBe(0)
    expect(named(root, 'firefox')).toEqual([
      'abs.png',
      'action/bell.png',
      'action/icons/dot.png',
      'action/on.png',
      'bell.png',
      'icons/dot.png',
      'on.png',
      'pages/info.html',
      'pop2.html',
      'up.png',
      'welcome.html'
    ])

    // Firefox opens a page path beside the popup, which the build moved.
    const popup = fs.readFileSync(
      path.join(root, 'dist/firefox/action/index.js'),
      'utf8'
    )
    expect(popup).toContain('"/welcome.html"')
    expect(popup).toContain('"/pages/info.html"')
    expect(popup).toContain('"/pop2.html"')

    // Background scripts run in a root page, where the paths already read.
    const background = fs.readFileSync(
      path.join(root, 'dist/firefox/background/scripts.js'),
      'utf8'
    )
    expect(background).toContain('"welcome.html"')
  }, 120_000)
})
