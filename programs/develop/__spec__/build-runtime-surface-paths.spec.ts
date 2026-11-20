import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'
import {buildProject} from './helpers/build-project'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project(
  files: Record<string, string>,
  background: unknown,
  manifest: Record<string, unknown> = {}
) {
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
      background,
      ...manifest
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
  return buildProject(root, {
    browser,
    mode: 'production'
  })
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

// A chunk import() made sits at the output root, and the browser asks for
// an icon beside the worker or the page that runs it.
describe('an icon a lazily imported module sets', () => {
  const LAZY = {
    'background.js':
      'globalThis.early = import("./lazy-bg.js").then((m) => m.set())\n',
    'lazy-bg.js':
      'export const set = () => chrome.action.setIcon({path: "on.png"})\n',
    'popup.html': '<html><body><script src="popup.js"></script></body></html>',
    'popup.js':
      'window.lazy = () => import("./lazy-pop.js").then((m) => m.set())\n',
    'lazy-pop.js':
      'export const set = () => chrome.action.setIcon({path: "pop.png"})\n',
    'on.png': 'png',
    'pop.png': 'png'
  }
  const icons = (root: string, browser: string) =>
    outputFiles(root, browser).filter((file) => file.endsWith('.png'))

  it('ships beside the worker that holds the call and the popup that loads the chunk, on chrome', async () => {
    const root = project(LAZY, {service_worker: 'background.js'})

    const summary = await build(root, 'chrome')
    expect(summary.errors_count).toBe(0)
    expect(summary.warnings || []).toEqual([])

    // A Chromium worker holds what it imports lazily, so only the popup's
    // call is in a chunk of its own, which no page names.
    const chunks = outputFiles(root, 'chrome').filter((file) =>
      /^[^/]+\.js$/.test(file)
    )
    const read = (file: string) =>
      fs.readFileSync(path.join(root, 'dist/chrome', file), 'utf8')

    expect(chunks).toHaveLength(1)
    expect(read(chunks[0])).toContain('"pop.png"')
    expect(read(chunks[0])).not.toContain('"on.png"')
    expect(read('background/service_worker.js')).toContain('"on.png"')
    expect(icons(root, 'chrome')).toEqual([
      'action/pop.png',
      'background/on.png'
    ])
  }, 120_000)

  it('ships beside both when the worker and the popup import one module lazily, on chrome', async () => {
    const root = project(
      {
        'background.js':
          'globalThis.early = import("./lazy-both.js").then((m) => m.set())\n',
        'popup.html': LAZY['popup.html'],
        'popup.js':
          'window.lazy = () => import("./lazy-both.js").then((m) => m.set())\n',
        'lazy-both.js':
          'export const set = () => chrome.action.setIcon({path: "both.png"})\n',
        'both.png': 'png'
      },
      {service_worker: 'background.js'}
    )

    const summary = await build(root, 'chrome')
    expect(summary.errors_count).toBe(0)
    expect(summary.warnings || []).toEqual([])

    // The worker runs its own copy and the popup loads a chunk, and Chrome
    // asks beside whichever of the two runs the call.
    expect(icons(root, 'chrome')).toEqual([
      'action/both.png',
      'background/both.png'
    ])
  }, 120_000)

  it('ships both places a firefox page may read, and the root for background scripts', async () => {
    const root = project(LAZY, {scripts: ['background.js']})

    const summary = await build(root, 'firefox')
    expect(summary.errors_count).toBe(0)
    expect(icons(root, 'firefox')).toEqual([
      'action/pop.png',
      'on.png',
      'pop.png'
    ])
  }, 120_000)
})

// Chrome shows a DevTools panel page from the extension root, whatever the
// folder of the DevTools page and however the path is spelled.
describe('a page a moved DevTools page shows as a panel', () => {
  const PANELS = {
    'background.js': '',
    'popup.html': '<html><body></body></html>',
    'dev/devtools.html':
      '<html><body><script src="devtools.js"></script></body></html>',
    'dev/devtools.js': [
      'chrome.devtools.panels.create("One", "icon.png", "./panel.html")',
      'chrome.devtools.panels.create("Two", "icon.png", "./only.html")',
      ''
    ].join('\n'),
    'panel.html': '<p>root panel</p>',
    'dev/panel.html': '<p>beside panel</p>',
    'dev/only.html': '<p>beside only</p>',
    'icon.png': 'png'
  }

  it('keeps the path of a file the root has and roots one only the folder has, on chrome', async () => {
    const root = project(
      PANELS,
      {service_worker: 'background.js'},
      {devtools_page: 'dev/devtools.html'}
    )

    const summary = await build(root, 'chrome')
    expect(summary.errors_count).toBe(0)

    const script = fs.readFileSync(
      path.join(root, 'dist/chrome/devtools/index.js'),
      'utf8'
    )

    expect(script).toContain('"./panel.html"')
    expect(script).toContain('"/dev/only.html"')
    expect(
      fs.readFileSync(path.join(root, 'dist/chrome/panel.html'), 'utf8')
    ).toContain('root panel')

    expect(
      fs.readFileSync(path.join(root, 'dist/chrome/dev/only.html'), 'utf8')
    ).toContain('beside only')
  }, 120_000)
})
