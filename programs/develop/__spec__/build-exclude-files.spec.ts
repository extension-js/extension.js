import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'
// The published type, so a config a project annotates with it is what the
// fixtures write and the typecheck gate fails once the type drops the key.
import type {FileConfig} from '../../extension/config-types'

// An offscreen document only Chromium opens lives in pages/ beside a page
// every browser ships. `browser.firefox.exclude` leaves it out of the Firefox
// build at the entry level: no HTML, no chunk, nothing the manifest names.
const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function stripAnsi(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/\u001b\[[0-9;]*m/g, '')
}

function project(
  files: Record<string, string>,
  config: FileConfig,
  manifest: Record<string, unknown> = {}
) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-exclude-'))
  roots.push(root)

  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'exclude', version: '0.0.0'})
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'exclude',
      version: '1.0.0',
      background: {service_worker: 'background.js'},
      ...manifest
    })
  )

  fs.writeFileSync(
    path.join(root, 'extension.config.js'),
    `module.exports = ${JSON.stringify(config)}\n`
  )

  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel)
    fs.mkdirSync(path.dirname(abs), {recursive: true})
    fs.writeFileSync(abs, content)
  }

  return root
}

type Diagnostic = {message: string; file?: string}
type FailedBuild = Error & {diagnostics?: Diagnostic[]}

async function build(
  root: string,
  browser: 'chrome' | 'firefox',
  mode: 'production' | 'development' = 'production'
) {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'

  try {
    return await extensionBuild(root, {
      browser,
      silent: true,
      install: false,
      mode,
      addonLint: false,
      exitOnError: false
    } as any)
  } finally {
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }
}

function emittedFiles(root: string, browser: string) {
  const dist = path.join(root, 'dist', browser)

  return (fs.readdirSync(dist, {recursive: true}) as string[])
    .filter((rel) => fs.statSync(path.join(dist, rel)).isFile())
    .map((rel) => rel.split(path.sep).join('/'))
    .sort()
}

function distText(root: string, browser: string) {
  const dist = path.join(root, 'dist', browser)

  return emittedFiles(root, browser)
    .map((rel) => fs.readFileSync(path.join(dist, rel), 'utf8'))
    .join('\n')
}

const page = (mark: string, script: string) =>
  `<!doctype html><html><body>${mark}<script src="./${script}"></script></body></html>\n`

const FILES = {
  'background.js': [
    "if (typeof chrome.offscreen !== 'undefined') {",
    '  chrome.offscreen.createDocument({',
    "    url: 'pages/offscreen.html',",
    "    reasons: ['AUDIO_PLAYBACK'],",
    "    justification: 'plays audio'",
    '  })',
    '}',
    ''
  ].join('\n'),
  'pages/offscreen.html': page('OFFSCREEN', 'offscreen.ts'),
  'pages/offscreen.ts': 'document.title = "OFFSCREEN_MARK"\n',
  'pages/settings.html': page('SETTINGS', 'settings.ts'),
  'pages/settings.ts': 'document.title = "SETTINGS_MARK"\n'
}

const FIREFOX_LEAVES_OFFSCREEN_OUT: FileConfig = {
  browser: {firefox: {exclude: ['pages/offscreen.html']}}
}

describe('browser.<vendor>.exclude for special-folder entries', () => {
  it('ships a Chromium-only page in the chrome build and not in the firefox one', async () => {
    const root = project(FILES, FIREFOX_LEAVES_OFFSCREEN_OUT)

    const chrome = await build(root, 'chrome')
    expect(chrome.errors_count).toBe(0)

    const chromeFiles = emittedFiles(root, 'chrome')
    expect(chromeFiles).toContain('pages/offscreen.html')
    expect(chromeFiles).toContain('pages/settings.html')
    expect(chromeFiles.some((rel) => /^pages\/offscreen\.js$/.test(rel))).toBe(
      true
    )

    expect(distText(root, 'chrome')).toContain('OFFSCREEN_MARK')

    const firefox = await build(root, 'firefox')
    expect(firefox.errors_count).toBe(0)

    const firefoxFiles = emittedFiles(root, 'firefox')
    expect(firefoxFiles).toContain('pages/settings.html')
    expect(firefoxFiles.filter((rel) => /offscreen/i.test(rel))).toEqual([])

    const text = distText(root, 'firefox')
    expect(text).toContain('SETTINGS_MARK')
    expect(text).not.toContain('OFFSCREEN_MARK')
  }, 240_000)

  it('leaves the page out of a development compile for that browser too', async () => {
    const root = project(FILES, FIREFOX_LEAVES_OFFSCREEN_OUT)

    const firefox = await build(root, 'firefox', 'development')
    expect(firefox.errors_count).toBe(0)

    const files = emittedFiles(root, 'firefox')
    expect(files).toContain('pages/settings.html')
    expect(files.filter((rel) => /offscreen/i.test(rel))).toEqual([])
    expect(distText(root, 'firefox')).not.toContain('OFFSCREEN_MARK')
  }, 240_000)

  it('refuses a build whose manifest still names the excluded page', async () => {
    const root = project(FILES, FIREFOX_LEAVES_OFFSCREEN_OUT, {
      options_page: 'pages/offscreen.html'
    })

    const chrome = await build(root, 'chrome')
    expect(chrome.errors_count).toBe(0)
    expect(emittedFiles(root, 'chrome')).toContain('pages/offscreen.html')

    let failure: FailedBuild | undefined

    try {
      await build(root, 'firefox')
    } catch (error) {
      failure = error as FailedBuild
    }

    expect(failure, 'the firefox build should fail').toBeDefined()

    const messages = (failure?.diagnostics || [])
      .map((entry) => stripAnsi(entry.message))
      .join('\n')
    expect(messages).toContain('pages/offscreen.html')
    expect(messages).toContain('firefox')
    expect(messages).toContain('exclude')
  }, 240_000)

  it('keeps an excluded public/ file out of that browser only', async () => {
    const root = project(
      {
        ...FILES,
        'public/chromium-rules.json': '{"rules": []}\n',
        'public/shared.txt': 'shared\n'
      },
      {
        browser: {
          firefox: {
            exclude: ['pages/offscreen.html', 'public/chromium-rules.json']
          }
        }
      }
    )

    expect((await build(root, 'chrome')).errors_count).toBe(0)
    expect(emittedFiles(root, 'chrome')).toContain('chromium-rules.json')

    expect((await build(root, 'firefox')).errors_count).toBe(0)
    const files = emittedFiles(root, 'firefox')
    expect(files).toContain('shared.txt')
    expect(files).not.toContain('chromium-rules.json')
  }, 240_000)

  it('layers the top-level, browser and command lists', async () => {
    // Typed, so the typecheck gate fails once a layer drops the key.
    const config: FileConfig = {
      exclude: ['pages/scratch.html'],
      browser: {firefox: {exclude: ['pages/offscreen.html']}},
      commands: {build: {exclude: ['scripts/bench.js']}}
    }
    const root = project(
      {
        ...FILES,
        'pages/scratch.html': page('SCRATCH', 'scratch.js'),
        'pages/scratch.js': 'document.title = "SCRATCH_MARK"\n',
        'scripts/content.js':
          'document.body.dataset.shipped = "CONTENT_MARK"\n',
        'scripts/bench.js': 'document.body.dataset.bench = "BENCH_MARK"\n'
      },
      config
    )

    expect((await build(root, 'chrome')).errors_count).toBe(0)
    const chromeFiles = emittedFiles(root, 'chrome')
    expect(chromeFiles).toContain('pages/offscreen.html')
    expect(chromeFiles).toContain('scripts/content.js')
    expect(chromeFiles).not.toContain('pages/scratch.html')
    expect(chromeFiles).not.toContain('scripts/bench.js')

    expect((await build(root, 'firefox')).errors_count).toBe(0)
    const firefoxFiles = emittedFiles(root, 'firefox')
    expect(firefoxFiles).toContain('scripts/content.js')
    expect(firefoxFiles).not.toContain('pages/offscreen.html')
    expect(firefoxFiles).not.toContain('pages/scratch.html')
    expect(firefoxFiles).not.toContain('scripts/bench.js')
  }, 240_000)
})
