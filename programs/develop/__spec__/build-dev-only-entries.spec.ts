import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-dev-only-'))
  roots.push(root)

  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'dev-only', version: '0.0.0'})
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'dev-only',
      version: '1.0.0',
      permissions: ['scripting', 'activeTab'],
      background: {service_worker: 'background.js'},
      web_accessible_resources: [
        {resources: ['pages/engine.html'], matches: ['<all_urls>']}
      ]
    })
  )

  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel)
    fs.mkdirSync(path.dirname(abs), {recursive: true})
    fs.writeFileSync(abs, content)
  }

  return root
}

async function build(
  root: string,
  mode: 'production' | 'development' = 'production'
) {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'

  try {
    return await extensionBuild(root, {
      browser: 'chrome',
      silent: true,
      install: false,
      mode,
      exitOnError: false
    } as any)
  } finally {
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }
}

function emittedFiles(root: string) {
  const dist = path.join(root, 'dist', 'chrome')

  return (fs.readdirSync(dist, {recursive: true}) as string[])
    .filter((rel) => fs.statSync(path.join(dist, rel)).isFile())
    .map((rel) => rel.split(path.sep).join('/'))
    .sort()
}

function distText(root: string) {
  const dist = path.join(root, 'dist', 'chrome')

  return emittedFiles(root)
    .map((rel) => fs.readFileSync(path.join(dist, rel), 'utf8'))
    .join('\n')
}

const page = (mark: string, script: string) =>
  `<!doctype html><html><body>${mark}<script src="./${script}"></script></body></html>\n`

const FILES = {
  'background.js': [
    'chrome.action.onClicked.addListener(() => {',
    "  chrome.tabs.create({url: chrome.runtime.getURL('pages/engine.html')})",
    "  if (process.env.NODE_ENV !== 'production') {",
    "    chrome.tabs.create({url: chrome.runtime.getURL('pages/player.dev.html')})",
    '  }',
    '})',
    ''
  ].join('\n'),
  'pages/engine.html': page('ENGINE', 'engine.js'),
  'pages/engine.js': 'document.title = "ENGINE_MARK"\n',
  'pages/player.dev.html': page('PLAYER', 'player.dev.js'),
  'pages/player.dev.js': 'document.title = "PLAYER_DEV_MARK"\n',
  'pages/bench/parity.dev.html': page('PARITY', 'parity.dev.js'),
  'pages/bench/parity.dev.js': 'document.title = "PARITY_DEV_MARK"\n',
  'scripts/content.js': 'document.body.dataset.shipped = "CONTENT_MARK"\n',
  'scripts/bench.dev.js': 'document.body.dataset.bench = "BENCH_DEV_MARK"\n'
}

describe('development-only entries in pages/ and scripts/', () => {
  it('ships them from a development compile and leaves them out of production', async () => {
    const root = project(FILES)

    const development = await build(root, 'development')
    expect(development.errors_count).toBe(0)

    const devFiles = emittedFiles(root)
    expect(devFiles).toContain('pages/player.dev.html')
    expect(devFiles).toContain('pages/bench/parity.dev.html')
    expect(devFiles).toContain('scripts/bench.dev.js')
    expect(devFiles).toContain('pages/engine.html')
    expect(devFiles).toContain('scripts/content.js')

    const devText = distText(root)
    expect(devText).toContain('PLAYER_DEV_MARK')
    expect(devText).toContain('PARITY_DEV_MARK')
    expect(devText).toContain('BENCH_DEV_MARK')

    const production = await build(root)
    expect(production.errors_count).toBe(0)

    const files = emittedFiles(root)
    // No HTML, no chunk, no manifest entry: the files never reach the output.
    expect(files).toContain('pages/engine.html')
    expect(files).toContain('scripts/content.js')
    expect(files.filter((rel) => /\.dev\./i.test(rel))).toEqual([])

    const text = distText(root)
    expect(text).toContain('ENGINE_MARK')
    expect(text).toContain('CONTENT_MARK')
    expect(text).not.toContain('PLAYER_DEV_MARK')
    expect(text).not.toContain('PARITY_DEV_MARK')
    expect(text).not.toContain('BENCH_DEV_MARK')

    const manifest = JSON.parse(
      fs.readFileSync(
        path.join(root, 'dist', 'chrome', 'manifest.json'),
        'utf8'
      )
    )
    expect(JSON.stringify(manifest)).not.toContain('.dev.')
    expect(JSON.stringify(manifest.web_accessible_resources)).toContain(
      'pages/engine.html'
    )
  }, 180_000)
})
